import { Router, Request, Response } from 'express'
import type { Document } from 'mongodb'
import { getEventFactClient } from '../repositories/event.repository'
import { parsePagination } from './helpers'
import { env } from '../env'
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

function buildFeedbackId(
  chainId: number,
  agentId: string,
  clientAddress: string,
  feedbackIndex: number,
): string {
  return `${chainId}:${agentId}:${clientAddress.toLowerCase()}:${feedbackIndex}`
}

function buildResponseId(
  feedbackId: string,
  txHash: string,
  logIndex: number,
): string {
  return `${feedbackId}:${txHash.toLowerCase()}:${logIndex}`
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

function addRegexFilter(target: Document, path: string, value: string | undefined): void {
  if (!value) return
  target[path] = { $regex: value, $options: 'i' }
}

export function createReputationRouter(): Router {
  const router = Router()

  /**
   * GET /v1/reputation
   * Global reputation explorer with recent feedback and metrics.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { page, limit, skip, chainId } = parsePagination(req.query)
      const effectiveChainId = chainId ?? env.CHAIN_ID
      const tag = typeof req.query.tag === 'string' && req.query.tag.trim().length > 0
        ? req.query.tag.trim()
        : undefined
      const endpoint = typeof req.query.endpoint === 'string' && req.query.endpoint.trim().length > 0
        ? req.query.endpoint.trim()
        : undefined

      const eventDb = await getEventFactClient()

      const feedbackFilter: Document = {
        chainId: effectiveChainId,
        eventName: 'NewFeedback',
      }
      if (tag) {
        feedbackFilter.$or = [
          { 'eventArgs.tag1': { $regex: tag, $options: 'i' } },
          { 'eventArgs.tag2': { $regex: tag, $options: 'i' } },
        ]
      }
      addRegexFilter(feedbackFilter, 'eventArgs.endpoint', endpoint)

      const responseFilter: Document = {
        chainId: effectiveChainId,
        eventName: 'ResponseAppended',
      }

      const [
        totalFeedbackEntries,
        totalRevocations,
        totalResponsesAppended,
        totalFilteredFeedback,
        totalFilteredResponses,
        recentFeedbackRows,
        recentResponseRows,
        uniqueAgentsWithFeedbackResult,
        uniqueClientsResult,
        uniqueRespondersResult,
        mostActiveClientResult,
        mostReviewedAgentResult,
        mostActiveResponderResult,
        tagDistributionRows,
        endpointPopularityRows,
      ] = await Promise.all([
        eventDb.count({ chainId: effectiveChainId, eventName: 'NewFeedback' }),
        eventDb.count({ chainId: effectiveChainId, eventName: 'FeedbackRevoked' }),
        eventDb.count({ chainId: effectiveChainId, eventName: 'ResponseAppended' }),
        eventDb.count(feedbackFilter),
        eventDb.count(responseFilter),
        eventDb.find(feedbackFilter, { blockNumber: -1, logIndex: -1 }, limit, skip),
        eventDb.find(responseFilter, { blockNumber: -1, logIndex: -1 }, limit, skip),
        eventDb.aggregate<{ count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.agentId' } },
          { $count: 'count' },
        ]),
        eventDb.aggregate<{ count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.clientAddress' } },
          { $count: 'count' },
        ]),
        eventDb.aggregate<{ count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'ResponseAppended' } },
          { $group: { _id: '$eventArgs.responder' } },
          { $count: 'count' },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.clientAddress', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.agentId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'ResponseAppended' } },
          { $group: { _id: '$eventArgs.responder', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.tag1', count: { $sum: 1 } } },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.endpoint', count: { $sum: 1 } } },
        ]),
      ])

      const uniqueResponders = uniqueRespondersResult[0]?.count ?? 0
      const feedbackVelocity = totalFeedbackEntries > 0
        ? totalFeedbackEntries / 30
        : null
      const responderDiversity = totalResponsesAppended > 0
        ? uniqueResponders / totalResponsesAppended
        : null

      const { revokedSet, revokedAtMap, responseCountMap } = await buildFeedbackStateMaps(
        effectiveChainId,
        recentFeedbackRows,
      )

      const recentFeedback = recentFeedbackRows.map((row) =>
        mapFeedbackRow(effectiveChainId, row, revokedSet, revokedAtMap, responseCountMap)
      )
      const recentResponses = recentResponseRows.map((row) =>
        mapResponseRow(effectiveChainId, row)
      )

      const tagDistribution: Record<string, number> = {}
      for (const row of tagDistributionRows) {
        if (typeof row._id === 'string' && row._id.length > 0) {
          tagDistribution[row._id] = row.count
        }
      }

      const endpointPopularity: Record<string, number> = {}
      for (const row of endpointPopularityRows) {
        if (typeof row._id === 'string' && row._id.length > 0) {
          endpointPopularity[row._id] = row.count
        }
      }

      res.json({
        metrics: {
          totalFeedbackEntries,
          totalRevocations,
          totalResponsesAppended,
          uniqueAgentsWithFeedback: uniqueAgentsWithFeedbackResult[0]?.count ?? 0,
          uniqueClients: uniqueClientsResult[0]?.count ?? 0,
          uniqueResponders,
          mostActiveClient: mostActiveClientResult[0]?._id ?? null,
          mostReviewedAgent: mostReviewedAgentResult[0]?._id
            ? String(mostReviewedAgentResult[0]._id)
            : null,
          mostActiveResponder: mostActiveResponderResult[0]?._id ?? null,
        },
        heuristics: {
          feedbackVelocity,
          responderDiversity,
          integrityFailureRate: null,
          sybilSuspicionAgents: [],
          tagDistribution,
          endpointPopularity,
        },
        recentFeedback: paginatedResult(recentFeedback, page, limit, totalFilteredFeedback),
        recentResponses: paginatedResult(recentResponses, page, limit, totalFilteredResponses),
      })
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch reputation data' })
    }
  })

  /**
   * GET /v1/reputation/:agentId
   * Agent-specific reputation detail.
   */
  router.get('/:agentId', async (req: Request, res: Response) => {
    try {
      const parsedAgentId = parseInt(req.params.agentId as string, 10)
      if (isNaN(parsedAgentId)) {
        res.status(400).json({ error: 'Invalid agentId' })
        return
      }

      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const { page, limit, skip } = parsePagination(req.query)
      const tag = typeof req.query.tag === 'string' && req.query.tag.trim().length > 0
        ? req.query.tag.trim()
        : undefined
      const endpoint = typeof req.query.endpoint === 'string' && req.query.endpoint.trim().length > 0
        ? req.query.endpoint.trim()
        : undefined

      const eventDb = await getEventFactClient()

      const feedbackFilter: Document = {
        chainId,
        eventName: 'NewFeedback',
        'eventArgs.agentId': parsedAgentId,
      }
      if (tag) {
        feedbackFilter.$or = [
          { 'eventArgs.tag1': { $regex: tag, $options: 'i' } },
          { 'eventArgs.tag2': { $regex: tag, $options: 'i' } },
        ]
      }
      addRegexFilter(feedbackFilter, 'eventArgs.endpoint', endpoint)

      const responseFilter: Document = {
        chainId,
        eventName: 'ResponseAppended',
        'eventArgs.agentId': parsedAgentId,
      }

      const [
        totalFeedbackEntries,
        totalRevocations,
        totalResponsesAppended,
        totalFilteredFeedback,
        totalFilteredResponses,
        recentFeedbackRows,
        recentResponseRows,
        uniqueClientsResult,
        uniqueRespondersResult,
        mostActiveClientResult,
        mostActiveResponderResult,
        tagDistributionRows,
        endpointPopularityRows,
      ] = await Promise.all([
        eventDb.count({ chainId, eventName: 'NewFeedback', 'eventArgs.agentId': parsedAgentId }),
        eventDb.count({ chainId, eventName: 'FeedbackRevoked', 'eventArgs.agentId': parsedAgentId }),
        eventDb.count({ chainId, eventName: 'ResponseAppended', 'eventArgs.agentId': parsedAgentId }),
        eventDb.count(feedbackFilter),
        eventDb.count(responseFilter),
        eventDb.find(feedbackFilter, { blockNumber: -1, logIndex: -1 }, limit, skip),
        eventDb.find(responseFilter, { blockNumber: -1, logIndex: -1 }, limit, skip),
        eventDb.aggregate<{ count: number }>([
          { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.agentId': parsedAgentId } },
          { $group: { _id: '$eventArgs.clientAddress' } },
          { $count: 'count' },
        ]),
        eventDb.aggregate<{ count: number }>([
          { $match: { chainId, eventName: 'ResponseAppended', 'eventArgs.agentId': parsedAgentId } },
          { $group: { _id: '$eventArgs.responder' } },
          { $count: 'count' },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.agentId': parsedAgentId } },
          { $group: { _id: '$eventArgs.clientAddress', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId, eventName: 'ResponseAppended', 'eventArgs.agentId': parsedAgentId } },
          { $group: { _id: '$eventArgs.responder', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.agentId': parsedAgentId } },
          { $group: { _id: '$eventArgs.tag1', count: { $sum: 1 } } },
        ]),
        eventDb.aggregate<{ _id: string; count: number }>([
          { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.agentId': parsedAgentId } },
          { $group: { _id: '$eventArgs.endpoint', count: { $sum: 1 } } },
        ]),
      ])

      const uniqueClients = uniqueClientsResult[0]?.count ?? 0
      const uniqueResponders = uniqueRespondersResult[0]?.count ?? 0
      const feedbackVelocity = totalFeedbackEntries > 0
        ? totalFeedbackEntries / 30
        : null
      const responderDiversity = totalResponsesAppended > 0
        ? uniqueResponders / totalResponsesAppended
        : null

      const { revokedSet, revokedAtMap, responseCountMap } = await buildFeedbackStateMaps(
        chainId,
        recentFeedbackRows,
      )

      const recentFeedback = recentFeedbackRows.map((row) =>
        mapFeedbackRow(chainId, row, revokedSet, revokedAtMap, responseCountMap)
      )
      const recentResponses = recentResponseRows.map((row) =>
        mapResponseRow(chainId, row)
      )

      const tagDistribution: Record<string, number> = {}
      for (const row of tagDistributionRows) {
        if (typeof row._id === 'string' && row._id.length > 0) {
          tagDistribution[row._id] = row.count
        }
      }

      const endpointPopularity: Record<string, number> = {}
      for (const row of endpointPopularityRows) {
        if (typeof row._id === 'string' && row._id.length > 0) {
          endpointPopularity[row._id] = row.count
        }
      }

      res.json({
        metrics: {
          totalFeedbackEntries,
          totalRevocations,
          totalResponsesAppended,
          uniqueAgentsWithFeedback: totalFeedbackEntries > 0 ? 1 : 0,
          uniqueClients,
          uniqueResponders,
          mostActiveClient: mostActiveClientResult[0]?._id ?? null,
          mostReviewedAgent: String(parsedAgentId),
          mostActiveResponder: mostActiveResponderResult[0]?._id ?? null,
        },
        heuristics: {
          feedbackVelocity,
          responderDiversity,
          integrityFailureRate: null,
          sybilSuspicionAgents: [],
          tagDistribution,
          endpointPopularity,
        },
        recentFeedback: paginatedResult(recentFeedback, page, limit, totalFilteredFeedback),
        recentResponses: paginatedResult(recentResponses, page, limit, totalFilteredResponses),
      })
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch agent reputation' })
    }
  })

  return router
}
