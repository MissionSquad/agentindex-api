import { Router, Request, Response } from 'express'
import type { Document } from 'mongodb'
import { getEventFactClient } from '../repositories/event.repository'
import { env } from '../env'
import { parsePagination } from './helpers'
import type { EventFact } from '../types/mongo'

interface FeedbackEntryDto {
  feedbackId: string
  agentId: string
  clientAddress: string
  feedbackIndex: number
  value: number
  valueDecimals: number
  normalizedValue: number
  tag1: string
  tag2: string
  endpoint: string
  feedbackUri: string
  feedbackHash: string
  integrity: 'pass' | 'fail' | 'unknown'
  revoked: boolean
  revokedAt: number | null
  responseCount: number
  timestamp: number
  txHash: string
}

interface ResponseEntryDto {
  responseId: string
  agentId: string
  clientAddress: string
  feedbackIndex: number
  responder: string
  responseUri: string
  responseHash: string
  integrity: 'pass' | 'fail' | 'unknown'
  timestamp: number
  txHash: string
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  return ''
}

function toLowerAddress(value: unknown): string {
  return toStringValue(value).toLowerCase()
}

function toTimestampMs(value: unknown): number {
  const parsed = toNumber(value)
  if (parsed > 0 && parsed < 1_000_000_000_000) return parsed * 1000
  return parsed
}

function normalizedFeedbackValue(value: unknown, decimals: unknown): number {
  const v = toNumber(value)
  const d = toNumber(decimals)
  const denominator = Math.pow(10, d)
  if (!Number.isFinite(denominator) || denominator === 0) return v
  return v / denominator
}

function paginatedResult<T>(items: T[], page: number, limit: number, total: number): {
  items: T[]
  meta: {
    page: number
    limit: number
    total: number
    hasNextPage: boolean
  }
} {
  return {
    items,
    meta: {
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    },
  }
}

function buildFeedbackId(
  chainId: number,
  agentId: string,
  clientAddress: string,
  feedbackIndex: number,
): string {
  return `${chainId}:${agentId}:${clientAddress.toLowerCase()}:${feedbackIndex}`
}

function buildResponseId(feedbackId: string, txHash: string, logIndex: number): string {
  return `${feedbackId}:${txHash.toLowerCase()}:${logIndex}`
}

function toFeedbackIdentityFilter(
  chainId: number,
  eventName: 'FeedbackRevoked' | 'ResponseAppended',
  row: EventFact,
): Document {
  const eventArgs = row.eventArgs as Record<string, unknown>
  return {
    chainId,
    eventName,
    'eventArgs.agentId': eventArgs['agentId'],
    'eventArgs.clientAddress': eventArgs['clientAddress'],
    'eventArgs.feedbackIndex': eventArgs['feedbackIndex'],
  }
}

async function buildFeedbackStateMaps(
  chainId: number,
  feedbackRows: EventFact[],
): Promise<{
  revokedSet: Set<string>
  revokedAtMap: Map<string, number>
  responseCountMap: Map<string, number>
}> {
  const eventDb = await getEventFactClient()
  if (feedbackRows.length === 0) {
    return {
      revokedSet: new Set<string>(),
      revokedAtMap: new Map<string, number>(),
      responseCountMap: new Map<string, number>(),
    }
  }

  const revocationFilters = feedbackRows.map((row) => toFeedbackIdentityFilter(chainId, 'FeedbackRevoked', row))
  const responseFilters = feedbackRows.map((row) => toFeedbackIdentityFilter(chainId, 'ResponseAppended', row))

  const [revocations, responses] = await Promise.all([
    eventDb.find({
      chainId,
      eventName: 'FeedbackRevoked',
      $or: revocationFilters,
    } as Document),
    eventDb.find({
      chainId,
      eventName: 'ResponseAppended',
      $or: responseFilters,
    } as Document),
  ])

  const revokedSet = new Set<string>()
  const revokedAtMap = new Map<string, number>()
  for (const revocation of revocations) {
    const eventArgs = revocation.eventArgs as Record<string, unknown>
    const feedbackId = buildFeedbackId(
      chainId,
      toStringValue(eventArgs['agentId']),
      toLowerAddress(eventArgs['clientAddress']),
      toNumber(eventArgs['feedbackIndex']),
    )
    revokedSet.add(feedbackId)
    revokedAtMap.set(feedbackId, toTimestampMs(revocation.timestamp))
  }

  const responseCountMap = new Map<string, number>()
  for (const response of responses) {
    const eventArgs = response.eventArgs as Record<string, unknown>
    const feedbackId = buildFeedbackId(
      chainId,
      toStringValue(eventArgs['agentId']),
      toLowerAddress(eventArgs['clientAddress']),
      toNumber(eventArgs['feedbackIndex']),
    )
    responseCountMap.set(feedbackId, (responseCountMap.get(feedbackId) ?? 0) + 1)
  }

  return { revokedSet, revokedAtMap, responseCountMap }
}

function mapFeedbackRow(
  chainId: number,
  row: EventFact,
  revokedSet: Set<string>,
  revokedAtMap: Map<string, number>,
  responseCountMap: Map<string, number>,
): FeedbackEntryDto {
  const eventArgs = row.eventArgs as Record<string, unknown>
  const agentId = toStringValue(eventArgs['agentId'])
  const clientAddress = toLowerAddress(eventArgs['clientAddress'])
  const feedbackIndex = toNumber(eventArgs['feedbackIndex'])
  const feedbackId = buildFeedbackId(chainId, agentId, clientAddress, feedbackIndex)

  return {
    feedbackId,
    agentId,
    clientAddress,
    feedbackIndex,
    value: toNumber(eventArgs['value']),
    valueDecimals: toNumber(eventArgs['valueDecimals']),
    normalizedValue: normalizedFeedbackValue(eventArgs['value'], eventArgs['valueDecimals']),
    tag1: toStringValue(eventArgs['tag1']),
    tag2: toStringValue(eventArgs['tag2']),
    endpoint: toStringValue(eventArgs['endpoint']),
    feedbackUri: toStringValue(eventArgs['feedbackURI']),
    feedbackHash: toStringValue(eventArgs['feedbackHash']),
    integrity: 'unknown',
    revoked: revokedSet.has(feedbackId),
    revokedAt: revokedAtMap.get(feedbackId) ?? null,
    responseCount: responseCountMap.get(feedbackId) ?? 0,
    timestamp: toTimestampMs(row.timestamp),
    txHash: row.txHash,
  }
}

function mapResponseRow(chainId: number, row: EventFact): ResponseEntryDto {
  const eventArgs = row.eventArgs as Record<string, unknown>
  const agentId = toStringValue(eventArgs['agentId'])
  const clientAddress = toLowerAddress(eventArgs['clientAddress'])
  const feedbackIndex = toNumber(eventArgs['feedbackIndex'])
  const feedbackId = buildFeedbackId(chainId, agentId, clientAddress, feedbackIndex)

  return {
    responseId: buildResponseId(feedbackId, row.txHash, row.logIndex),
    agentId,
    clientAddress,
    feedbackIndex,
    responder: toLowerAddress(eventArgs['responder']),
    responseUri: toStringValue(eventArgs['responseURI']),
    responseHash: toStringValue(eventArgs['responseHash']),
    integrity: 'unknown',
    timestamp: toTimestampMs(row.timestamp),
    txHash: row.txHash,
  }
}

function decodeAddressFromMetadataValue(value: unknown): string | null {
  const raw = toStringValue(value).toLowerCase()
  if (!raw.startsWith('0x')) return null

  if (/^0x[0-9a-f]{40}$/.test(raw)) {
    return raw
  }

  if (/^0x[0-9a-f]{64}$/.test(raw)) {
    return `0x${raw.slice(-40)}`
  }

  return null
}

export function createAddressesRouter(): Router {
  const router = Router()

  /**
   * GET /v1/address/:address
   * Wallet-centric view of all ERC-8004 activity for an address.
   */
  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const address = (req.params.address as string).toLowerCase()
      if (!/^0x[0-9a-f]{40}$/.test(address)) {
        res.status(400).json({ error: 'Invalid address format' })
        return
      }

      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const { page, limit, skip } = parsePagination(req.query)
      const eventDb = await getEventFactClient()

      const [
        registeredRows,
        transferredAwayRows,
        receivedViaTransferRows,
        currentlyOwnedRows,
        feedbackTotal,
        feedbackRows,
        revocationCount,
        agentsReviewedRows,
        averageScoreRows,
        responseTotal,
        responseRows,
        agentsRespondedRows,
        uriUpdateCount,
        payoutWalletRows,
      ] = await Promise.all([
        eventDb.find(
          { chainId, eventName: 'Registered', 'eventArgs.owner': address } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          {
            chainId,
            eventName: 'Transfer',
            $and: [
              { 'eventArgs.from': address },
              { 'eventArgs.from': { $ne: '0x0000000000000000000000000000000000000000' } },
            ],
          } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          {
            chainId,
            eventName: 'Transfer',
            'eventArgs.to': address,
            'eventArgs.from': { $ne: '0x0000000000000000000000000000000000000000' },
          } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.aggregate<{ _id: unknown }>([
          { $match: { chainId, eventName: 'Transfer' } },
          {
            $project: {
              tokenId: '$eventArgs.tokenId',
              toLower: { $toLower: '$eventArgs.to' },
              blockNumber: '$blockNumber',
              logIndex: '$logIndex',
            },
          },
          { $sort: { blockNumber: -1, logIndex: -1 } },
          { $group: { _id: '$tokenId', latestTo: { $first: '$toLower' } } },
          { $match: { latestTo: address } },
          { $project: { _id: 1 } },
        ]),
        eventDb.count({ chainId, eventName: 'NewFeedback', 'eventArgs.clientAddress': address } as Document),
        eventDb.find(
          { chainId, eventName: 'NewFeedback', 'eventArgs.clientAddress': address } as Document,
          { blockNumber: -1, logIndex: -1 },
          limit,
          skip,
        ),
        eventDb.count({ chainId, eventName: 'FeedbackRevoked', 'eventArgs.clientAddress': address } as Document),
        eventDb.aggregate<{ _id: unknown }>([
          { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.clientAddress': address } },
          { $group: { _id: '$eventArgs.agentId' } },
        ]),
        eventDb.aggregate<{ avg: number }>([
          { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.clientAddress': address } },
          {
            $project: {
              normalizedValue: {
                $divide: [
                  { $convert: { input: '$eventArgs.value', to: 'double', onError: 0, onNull: 0 } },
                  {
                    $pow: [
                      10,
                      { $convert: { input: '$eventArgs.valueDecimals', to: 'double', onError: 0, onNull: 0 } },
                    ],
                  },
                ],
              },
            },
          },
          { $group: { _id: null, avg: { $avg: '$normalizedValue' } } },
        ]),
        eventDb.count({ chainId, eventName: 'ResponseAppended', 'eventArgs.responder': address } as Document),
        eventDb.find(
          { chainId, eventName: 'ResponseAppended', 'eventArgs.responder': address } as Document,
          { blockNumber: -1, logIndex: -1 },
          limit,
          skip,
        ),
        eventDb.aggregate<{ _id: unknown }>([
          { $match: { chainId, eventName: 'ResponseAppended', 'eventArgs.responder': address } },
          { $group: { _id: '$eventArgs.agentId' } },
        ]),
        eventDb.count({ chainId, eventName: 'URIUpdated', 'eventArgs.updatedBy': address } as Document),
        eventDb.find(
          {
            chainId,
            eventName: 'MetadataSet',
            $or: [
              { 'eventArgs.metadataKey': { $regex: '^agentWallet$', $options: 'i' } },
              { 'eventArgs.indexedMetadataKey': { $regex: '^agentWallet$', $options: 'i' } },
            ],
          } as Document,
          { blockNumber: -1, logIndex: -1 },
          5000,
        ),
      ])

      const { revokedSet, revokedAtMap, responseCountMap } = await buildFeedbackStateMaps(chainId, feedbackRows)
      const feedbackEntries = feedbackRows.map((row) =>
        mapFeedbackRow(chainId, row, revokedSet, revokedAtMap, responseCountMap)
      )

      const responseEntries = responseRows.map((row) => mapResponseRow(chainId, row))

      const agentsOriginallyRegistered = Array.from(new Set(
        registeredRows.map((row) => toStringValue((row.eventArgs as Record<string, unknown>)['agentId']))
      ))
      const agentsTransferredAway = Array.from(new Set(
        transferredAwayRows.map((row) => toStringValue((row.eventArgs as Record<string, unknown>)['tokenId']))
      ))
      const agentsReceivedViaTransfer = Array.from(new Set(
        receivedViaTransferRows.map((row) => toStringValue((row.eventArgs as Record<string, unknown>)['tokenId']))
      ))
      const agentsCurrentlyOwned = Array.from(new Set(
        currentlyOwnedRows.map((row) => toStringValue(row._id))
      ))

      const agentsReviewed = agentsReviewedRows
        .map((row) => toStringValue(row._id))
        .filter((agentId) => agentId.length > 0)

      const agentsRespondedTo = agentsRespondedRows
        .map((row) => toStringValue(row._id))
        .filter((agentId) => agentId.length > 0)

      const payoutWalletAgentIdSet = new Set<string>()
      for (const row of payoutWalletRows) {
        const eventArgs = row.eventArgs as Record<string, unknown>
        const metadataValueAddress = decodeAddressFromMetadataValue(eventArgs['metadataValue'])
        if (metadataValueAddress !== address) continue

        const agentId = toStringValue(eventArgs['agentId'])
        if (agentId.length > 0) {
          payoutWalletAgentIdSet.add(agentId)
        }
      }

      res.json({
        address,
        owner: {
          agentsCurrentlyOwned,
          agentsOriginallyRegistered,
          agentsTransferredAway,
          agentsReceivedViaTransfer,
        },
        feedbackClient: {
          feedback: paginatedResult(feedbackEntries, page, limit, feedbackTotal),
          agentsReviewed,
          revocationCount,
          averageScoreGiven: averageScoreRows[0]?.avg ?? null,
          feedbackIntegrityRate: null,
        },
        responder: {
          responses: paginatedResult(responseEntries, page, limit, responseTotal),
          agentsRespondedTo,
          responseCount: responseTotal,
          averageResponseLatencyHours: null,
        },
        payoutWalletAgentIds: Array.from(payoutWalletAgentIdSet),
        uriUpdateCount,
      })
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch address profile' })
    }
  })

  return router
}
