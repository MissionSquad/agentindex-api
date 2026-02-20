import { Router, Request, Response } from 'express'
import type { EvmDecoder } from 'evmdecoder'
import { getTxFactClient, getCallFactClient } from '../repositories/transaction.repository'
import { getEventFactClient } from '../repositories/event.repository'
import { TransactionDecodeService } from '../services/transaction-decode.service'
import { log } from '../utils/logger'
import { env } from '../env'

export interface TransactionsRouterDeps {
  getDecoder: () => EvmDecoder | null
  chainId: number
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

        res.json({
          transactionFact: txFact,
          callFact: safeCallFact,
          eventFacts: events,
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
            res.json({
              transactionFact: decoded.transactionFact,
              callFact: decoded.callFact,
              eventFacts: decoded.eventFacts,
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
