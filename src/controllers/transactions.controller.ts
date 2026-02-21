import { Router, Request, Response } from 'express'
import type { EvmDecoder } from 'evmdecoder'
import { getTxFactClient, getCallFactClient } from '../repositories/transaction.repository'
import { getEventFactClient } from '../repositories/event.repository'
import { getAgentMetadataBatch } from '../repositories/agent-metadata.repository'
import { TransactionDecodeService } from '../services/transaction-decode.service'
import { log } from '../utils/logger'
import { env } from '../env'

export interface TransactionsRouterDeps {
  getDecoder: () => EvmDecoder | null
  chainId: number
}

const AGENT_ID_KEYS = new Set(['agentId', 'tokenId', '_tokenId'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectAgentIdFromValue(value: unknown, target: Set<number>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target.add(value)
    return
  }

  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      target.add(parsed)
    }
  }
}

function collectAgentIdsFromArgs(args: Record<string, unknown>, target: Set<number>): void {
  for (const [key, value] of Object.entries(args)) {
    if (!AGENT_ID_KEYS.has(key)) continue
    collectAgentIdFromValue(value, target)
  }
}

async function buildRelatedAgents(
  chainId: number,
  callArgs: unknown,
  events: Array<{ eventArgs?: unknown }>,
): Promise<Array<{ agentId: string; name: string; imageUrl: string | null }>> {
  const ids = new Set<number>()
  if (isRecord(callArgs)) {
    collectAgentIdsFromArgs(callArgs, ids)
  }

  for (const eventFact of events) {
    if (isRecord(eventFact.eventArgs)) {
      collectAgentIdsFromArgs(eventFact.eventArgs, ids)
    }
  }

  const orderedAgentIds = Array.from(ids)
  if (orderedAgentIds.length === 0) return []

  const metadataRows = await getAgentMetadataBatch(chainId, orderedAgentIds)
  const metadataByAgent = new Map<string, { name: string | null; image: string | null }>()
  for (const row of metadataRows) {
    metadataByAgent.set(String(row.agentId), { name: row.name, image: row.image })
  }

  return orderedAgentIds.map((agentId) => {
    const key = String(agentId)
    const metadata = metadataByAgent.get(key)
    return {
      agentId: key,
      name: metadata?.name ?? `Agent ${agentId}`,
      imageUrl: metadata?.image ?? null,
    }
  })
}

export function createTransactionsRouter(deps?: TransactionsRouterDeps): Router {
  const router = Router()
  const decodeService = deps ? new TransactionDecodeService() : null

  /**
   * GET /v1/transactions/:txHash
   * Full transaction detail including call and events.
   * Falls back to real-time RPC decode when not found in MongoDB (if decoder is available).
   */
  router.get('/:txHash', async (req: Request, res: Response) => {
    try {
      const txHash = (req.params.txHash as string).toLowerCase()
      if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
        res.status(400).json({ error: 'Invalid transaction hash format' })
        return
      }

      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const txDb = await getTxFactClient()
      const callDb = await getCallFactClient()
      const eventDb = await getEventFactClient()

      const [txFact, callFact, events] = await Promise.all([
        txDb.findOne({ chainId, txHash }),
        callDb.findOne({ chainId, txHash }),
        eventDb.find({ chainId, txHash }, { logIndex: 1 }),
      ])

      if (txFact) {
        const safeCallFact = callFact ?? {
          functionName: '',
          functionSignature: '',
          rawArgs: {},
          normalizedArgs: {},
        }
        const relatedAgents = await buildRelatedAgents(
          chainId,
          safeCallFact.normalizedArgs,
          events as Array<{ eventArgs?: unknown }>,
        )

        res.json({
          transactionFact: txFact,
          callFact: safeCallFact,
          eventFacts: events,
          relatedAgents,
        })
        return
      }

      // Not in MongoDB — attempt real-time decode via RPC
      if (decodeService && deps) {
        const decoder = deps.getDecoder()
        if (decoder) {
          log({ level: 'info', msg: `Real-time decode requested for tx ${txHash}` })
          const decoded = await decodeService.decode(decoder, deps.chainId, txHash)
          if (decoded) {
            const relatedAgents = await buildRelatedAgents(
              chainId,
              decoded.callFact.normalizedArgs,
              decoded.eventFacts as Array<{ eventArgs?: unknown }>,
            )
            res.json({
              transactionFact: decoded.transactionFact,
              callFact: decoded.callFact,
              eventFacts: decoded.eventFacts,
              relatedAgents,
            })
            return
          }
        }
      }

      res.status(404).json({ error: 'Transaction not found' })
    } catch (error) {
      log({ level: 'error', msg: 'Failed to fetch transaction', error })
      res.status(500).json({ error: 'Failed to fetch transaction' })
    }
  })

  return router
}
