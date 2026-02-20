import { Router, Request, Response } from 'express'
import type { Document } from 'mongodb'
import { getEventFactClient } from '../repositories/event.repository'
import { parsePagination } from './helpers'
import { env } from '../env'
import type { EventFact } from '../types/mongo'
import { buildNetworkGraph } from '../services/network-graph.service'

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

interface AgentSummaryDto {
  chainId: number
  agentId: string
  ownerAddress: string
  originalRegistrant: string
  agentUri: string
  name: string
  description: string
  imageUrl: string | null
  tags: string[]
  services: string[]
  x402Support: boolean
  registrationTxHash: string
  registrationTimestamp: number
  hasBeenTransferred: boolean
  transferCount: number
  feedbackCount: number
  responseCount: number
  averageReputation: number | null
  lastActiveTimestamp: number | null
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

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return undefined
}

function feedbackKey(chainId: number, eventArgs: Record<string, unknown>): string {
  return `${chainId}:${toStringValue(eventArgs['agentId'])}:${toLowerAddress(eventArgs['clientAddress'])}:${toNumber(eventArgs['feedbackIndex'])}`
}

function responseId(chainId: number, row: EventFact): string {
  const eventArgs = row.eventArgs as Record<string, unknown>
  const key = feedbackKey(chainId, eventArgs)
  return `${key}:${row.txHash.toLowerCase()}:${row.logIndex}`
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

function average(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((acc, value) => acc + value, 0)
  return sum / values.length
}

function calcFeedbackBurstRatio30d(feedbackRows: EventFact[]): number | null {
  if (feedbackRows.length === 0) return null

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const countsByDay = new Map<string, number>()

  for (const row of feedbackRows) {
    const ts = toTimestampMs(row.timestamp)
    if (ts < thirtyDaysAgo) continue
    const key = new Date(ts).toISOString().slice(0, 10)
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1)
  }

  const counts = Array.from(countsByDay.values()).sort((a, b) => a - b)
  if (counts.length === 0) return null
  const max = counts[counts.length - 1]
  const median = counts[Math.floor(counts.length / 2)]
  if (!median || median <= 0) return null
  return max / median
}

function describeEvent(eventName: string, args: Record<string, unknown>): string {
  if (eventName === 'Registered') {
    return `Registered by ${toStringValue(args['owner'])}`
  }
  if (eventName === 'NewFeedback') {
    return `Feedback from ${toStringValue(args['clientAddress'])}`
  }
  if (eventName === 'FeedbackRevoked') {
    return `Feedback revoked by ${toStringValue(args['clientAddress'])}`
  }
  if (eventName === 'ResponseAppended') {
    return `Response by ${toStringValue(args['responder'])}`
  }
  if (eventName === 'Transfer') {
    return `Transfer ${toStringValue(args['from'])} -> ${toStringValue(args['to'])}`
  }
  if (eventName === 'URIUpdated') {
    return `URI updated by ${toStringValue(args['updatedBy'])}`
  }
  if (eventName === 'MetadataSet') {
    return `Metadata ${toStringValue(args['metadataKey'])}`
  }
  return 'Event observed'
}

function parseSortOption(value: unknown): 'newest' | 'oldest' | 'most-feedback' | 'highest-reputation' | 'recently-active' {
  if (
    value === 'newest' ||
    value === 'oldest' ||
    value === 'most-feedback' ||
    value === 'highest-reputation' ||
    value === 'recently-active'
  ) {
    return value
  }
  return 'newest'
}

function compareNullableNumberDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function createAgentsRouter(): Router {
  const router = Router()

  /**
   * GET /v1/agents
   * List registered agents with pagination, sorting, and filters.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { page, limit, chainId } = parsePagination(req.query)
      const effectiveChainId = chainId ?? env.CHAIN_ID
      const sort = parseSortOption(req.query.sort)
      const hasFeedback = parseBooleanQuery(req.query.hasFeedback)
      const hasBeenTransferred = parseBooleanQuery(req.query.hasBeenTransferred)
      const hasResponses = parseBooleanQuery(req.query.hasResponses)
      const x402Support = parseBooleanQuery(req.query.x402Support)
      const protocol = typeof req.query.protocol === 'string' && req.query.protocol.length > 0
        ? req.query.protocol
        : undefined
      const tag = typeof req.query.tag === 'string' && req.query.tag.trim().length > 0
        ? req.query.tag.trim()
        : undefined
      const registeredSinceDays = req.query.registeredSinceDays
        ? Math.max(0, parseInt(req.query.registeredSinceDays as string, 10))
        : undefined

      const eventDb = await getEventFactClient()

      const [
        registrationRows,
        feedbackStatsRows,
        responseStatsRows,
        transferStatsRows,
        latestOwnerRows,
        latestUriRows,
        tagRows,
      ] = await Promise.all([
        eventDb.find(
          { chainId: effectiveChainId, eventName: 'Registered' } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.aggregate<{ _id: unknown; count: number; avg: number; lastTs: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'NewFeedback' } },
          {
            $project: {
              agentId: '$eventArgs.agentId',
              timestamp: '$timestamp',
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
          {
            $group: {
              _id: '$agentId',
              count: { $sum: 1 },
              avg: { $avg: '$normalizedValue' },
              lastTs: { $max: '$timestamp' },
            },
          },
        ]),
        eventDb.aggregate<{ _id: unknown; count: number; lastTs: number }>([
          { $match: { chainId: effectiveChainId, eventName: 'ResponseAppended' } },
          {
            $group: {
              _id: '$eventArgs.agentId',
              count: { $sum: 1 },
              lastTs: { $max: '$timestamp' },
            },
          },
        ]),
        eventDb.aggregate<{ _id: unknown; count: number }>([
          {
            $match: {
              chainId: effectiveChainId,
              eventName: 'Transfer',
              'eventArgs.from': { $ne: '0x0000000000000000000000000000000000000000' },
            },
          },
          { $group: { _id: '$eventArgs.tokenId', count: { $sum: 1 } } },
        ]),
        eventDb.aggregate<{ _id: unknown; to: string }>([
          { $match: { chainId: effectiveChainId, eventName: 'Transfer' } },
          {
            $project: {
              tokenId: '$eventArgs.tokenId',
              toLower: { $toLower: '$eventArgs.to' },
              blockNumber: '$blockNumber',
              logIndex: '$logIndex',
            },
          },
          { $sort: { blockNumber: -1, logIndex: -1 } },
          { $group: { _id: '$tokenId', to: { $first: '$toLower' } } },
        ]),
        eventDb.aggregate<{ _id: unknown; uri: string }>([
          { $match: { chainId: effectiveChainId, eventName: 'URIUpdated' } },
          {
            $project: {
              agentId: '$eventArgs.agentId',
              newURI: '$eventArgs.newURI',
              blockNumber: '$blockNumber',
              logIndex: '$logIndex',
            },
          },
          { $sort: { blockNumber: -1, logIndex: -1 } },
          { $group: { _id: '$agentId', uri: { $first: '$newURI' } } },
        ]),
        tag
          ? eventDb.aggregate<{ _id: unknown }>([
            {
              $match: {
                chainId: effectiveChainId,
                eventName: 'NewFeedback',
                $or: [
                  { 'eventArgs.tag1': { $regex: tag, $options: 'i' } },
                  { 'eventArgs.tag2': { $regex: tag, $options: 'i' } },
                ],
              },
            },
            { $group: { _id: '$eventArgs.agentId' } },
          ])
          : Promise.resolve([]),
      ])

      const registrationByAgent = new Map<string, EventFact>()
      for (const row of registrationRows) {
        const args = row.eventArgs as Record<string, unknown>
        const agentId = toStringValue(args['agentId'])
        if (!agentId || registrationByAgent.has(agentId)) continue
        registrationByAgent.set(agentId, row)
      }

      const feedbackStatsByAgent = new Map<string, { count: number; avg: number | null; lastTs: number | null }>()
      for (const row of feedbackStatsRows) {
        const key = toStringValue(row._id)
        feedbackStatsByAgent.set(key, {
          count: row.count,
          avg: Number.isFinite(row.avg) ? row.avg : null,
          lastTs: row.lastTs ? toTimestampMs(row.lastTs) : null,
        })
      }

      const responseStatsByAgent = new Map<string, { count: number; lastTs: number | null }>()
      for (const row of responseStatsRows) {
        const key = toStringValue(row._id)
        responseStatsByAgent.set(key, {
          count: row.count,
          lastTs: row.lastTs ? toTimestampMs(row.lastTs) : null,
        })
      }

      const transferCountByAgent = new Map<string, number>()
      for (const row of transferStatsRows) {
        transferCountByAgent.set(toStringValue(row._id), row.count)
      }

      const latestOwnerByAgent = new Map<string, string>()
      for (const row of latestOwnerRows) {
        latestOwnerByAgent.set(toStringValue(row._id), toLowerAddress(row.to))
      }

      const latestUriByAgent = new Map<string, string>()
      for (const row of latestUriRows) {
        latestUriByAgent.set(toStringValue(row._id), toStringValue(row.uri))
      }

      const tagAgentSet = new Set<string>(tagRows.map((row) => toStringValue(row._id)))

      const now = Date.now()
      const registeredSinceThreshold = registeredSinceDays !== undefined
        ? now - registeredSinceDays * 24 * 60 * 60 * 1000
        : undefined

      let summaries: AgentSummaryDto[] = Array.from(registrationByAgent.entries()).map(([agentId, registration]) => {
        const args = registration.eventArgs as Record<string, unknown>
        const feedbackStats = feedbackStatsByAgent.get(agentId)
        const responseStats = responseStatsByAgent.get(agentId)
        const transferCount = transferCountByAgent.get(agentId) ?? 0
        const registrationTimestamp = toTimestampMs(registration.timestamp)
        const feedbackLastTs = feedbackStats?.lastTs ?? null
        const responseLastTs = responseStats?.lastTs ?? null
        const lastActiveTimestamp = feedbackLastTs !== null || responseLastTs !== null
          ? Math.max(feedbackLastTs ?? 0, responseLastTs ?? 0)
          : null

        return {
          chainId: effectiveChainId,
          agentId,
          ownerAddress: latestOwnerByAgent.get(agentId) ?? toLowerAddress(args['owner']),
          originalRegistrant: toLowerAddress(args['owner']),
          agentUri: latestUriByAgent.get(agentId) ?? toStringValue(args['agentURI']),
          name: `Agent ${agentId}`,
          description: '',
          imageUrl: null,
          tags: [],
          services: [],
          x402Support: false,
          registrationTxHash: registration.txHash,
          registrationTimestamp,
          hasBeenTransferred: transferCount > 0,
          transferCount,
          feedbackCount: feedbackStats?.count ?? 0,
          responseCount: responseStats?.count ?? 0,
          averageReputation: feedbackStats?.avg ?? null,
          lastActiveTimestamp,
        }
      })

      if (registeredSinceThreshold !== undefined) {
        summaries = summaries.filter((summary) => summary.registrationTimestamp >= registeredSinceThreshold)
      }

      if (hasFeedback !== undefined) {
        summaries = summaries.filter((summary) => (summary.feedbackCount > 0) === hasFeedback)
      }

      if (hasBeenTransferred !== undefined) {
        summaries = summaries.filter((summary) => summary.hasBeenTransferred === hasBeenTransferred)
      }

      if (hasResponses !== undefined) {
        summaries = summaries.filter((summary) => (summary.responseCount > 0) === hasResponses)
      }

      if (x402Support !== undefined) {
        summaries = summaries.filter((summary) => summary.x402Support === x402Support)
      }

      if (protocol) {
        summaries = summaries.filter((summary) => summary.services.includes(protocol))
      }

      if (tag) {
        summaries = summaries.filter((summary) => tagAgentSet.has(summary.agentId))
      }

      summaries.sort((left, right) => {
        if (sort === 'oldest') {
          return left.registrationTimestamp - right.registrationTimestamp
        }
        if (sort === 'most-feedback') {
          return right.feedbackCount - left.feedbackCount
        }
        if (sort === 'highest-reputation') {
          return compareNullableNumberDesc(left.averageReputation, right.averageReputation)
        }
        if (sort === 'recently-active') {
          return compareNullableNumberDesc(left.lastActiveTimestamp, right.lastActiveTimestamp)
        }
        return right.registrationTimestamp - left.registrationTimestamp
      })

      const total = summaries.length
      const start = (page - 1) * limit
      const items = summaries.slice(start, start + limit)

      res.json({
        items,
        meta: {
          page,
          limit,
          total,
          hasNextPage: page * limit < total,
        },
      })
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch agents' })
    }
  })

  /**
   * GET /v1/agents/:agentId
   * Get a single agent by ID.
   */
  router.get('/:agentId', async (req: Request, res: Response) => {
    try {
      const parsedAgentId = parseInt(req.params.agentId as string, 10)
      if (isNaN(parsedAgentId)) {
        res.status(400).json({ error: 'Invalid agentId' })
        return
      }

      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const eventDb = await getEventFactClient()
      const agentId = String(parsedAgentId)

      const registration = await eventDb.findOne({
        chainId,
        eventName: 'Registered',
        'eventArgs.agentId': parsedAgentId,
      } as Document)

      if (!registration) {
        res.status(404).json({ error: 'Agent not found' })
        return
      }

      const [
        feedbackRows,
        responseRows,
        revocationRows,
        transferRows,
        uriRows,
        metadataRows,
      ] = await Promise.all([
        eventDb.find(
          { chainId, eventName: 'NewFeedback', 'eventArgs.agentId': parsedAgentId } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          { chainId, eventName: 'ResponseAppended', 'eventArgs.agentId': parsedAgentId } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          { chainId, eventName: 'FeedbackRevoked', 'eventArgs.agentId': parsedAgentId } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          { chainId, eventName: 'Transfer', 'eventArgs.tokenId': parsedAgentId } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          { chainId, eventName: 'URIUpdated', 'eventArgs.agentId': parsedAgentId } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
        eventDb.find(
          { chainId, eventName: 'MetadataSet', 'eventArgs.agentId': parsedAgentId } as Document,
          { blockNumber: -1, logIndex: -1 },
        ),
      ])

      const args = registration.eventArgs as Record<string, unknown>

      const feedbackRowsSortedByTime = [...feedbackRows].sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp))
      const responseRowsSortedByTime = [...responseRows].sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp))

      const revokedSet = new Set<string>()
      const revokedAtMap = new Map<string, number>()
      for (const row of revocationRows) {
        const rowArgs = row.eventArgs as Record<string, unknown>
        const key = feedbackKey(chainId, rowArgs)
        revokedSet.add(key)
        revokedAtMap.set(key, toTimestampMs(row.timestamp))
      }

      const responseCountMap = new Map<string, number>()
      const firstResponseAtMap = new Map<string, number>()
      for (const row of responseRowsSortedByTime) {
        const rowArgs = row.eventArgs as Record<string, unknown>
        const key = feedbackKey(chainId, rowArgs)
        responseCountMap.set(key, (responseCountMap.get(key) ?? 0) + 1)
        if (!firstResponseAtMap.has(key)) {
          firstResponseAtMap.set(key, toTimestampMs(row.timestamp))
        }
      }

      const feedbackEntries: FeedbackEntryDto[] = feedbackRows.map((row) => {
        const rowArgs = row.eventArgs as Record<string, unknown>
        const key = feedbackKey(chainId, rowArgs)
        return {
          feedbackId: key,
          agentId,
          clientAddress: toLowerAddress(rowArgs['clientAddress']),
          feedbackIndex: toNumber(rowArgs['feedbackIndex']),
          value: toNumber(rowArgs['value']),
          valueDecimals: toNumber(rowArgs['valueDecimals']),
          normalizedValue: normalizedFeedbackValue(rowArgs['value'], rowArgs['valueDecimals']),
          tag1: toStringValue(rowArgs['tag1']),
          tag2: toStringValue(rowArgs['tag2']),
          endpoint: toStringValue(rowArgs['endpoint']),
          feedbackUri: toStringValue(rowArgs['feedbackURI']),
          feedbackHash: toStringValue(rowArgs['feedbackHash']),
          integrity: 'unknown',
          revoked: revokedSet.has(key),
          revokedAt: revokedAtMap.get(key) ?? null,
          responseCount: responseCountMap.get(key) ?? 0,
          timestamp: toTimestampMs(row.timestamp),
          txHash: row.txHash,
        }
      })

      const responseEntries: ResponseEntryDto[] = responseRows.map((row) => {
        const rowArgs = row.eventArgs as Record<string, unknown>
        return {
          responseId: responseId(chainId, row),
          agentId,
          clientAddress: toLowerAddress(rowArgs['clientAddress']),
          feedbackIndex: toNumber(rowArgs['feedbackIndex']),
          responder: toLowerAddress(rowArgs['responder']),
          responseUri: toStringValue(rowArgs['responseURI']),
          responseHash: toStringValue(rowArgs['responseHash']),
          integrity: 'unknown',
          timestamp: toTimestampMs(row.timestamp),
          txHash: row.txHash,
        }
      })

      const ownerAddress = transferRows.length > 0
        ? toLowerAddress((transferRows[0].eventArgs as Record<string, unknown>)['to'])
        : toLowerAddress(args['owner'])
      const currentUri = uriRows.length > 0
        ? toStringValue((uriRows[0].eventArgs as Record<string, unknown>)['newURI'])
        : toStringValue(args['agentURI'])
      const transferCount = transferRows.filter((row) => {
        const rowArgs = row.eventArgs as Record<string, unknown>
        return toLowerAddress(rowArgs['from']) !== '0x0000000000000000000000000000000000000000'
      }).length

      const normalizedScores = feedbackEntries.map((entry) => entry.normalizedValue)
      const averageReputation = average(normalizedScores)

      const feedbackTimestamps = feedbackEntries.map((entry) => entry.timestamp)
      const responseTimestamps = responseEntries.map((entry) => entry.timestamp)
      const allActivityTimestamps = [...feedbackTimestamps, ...responseTimestamps]
      const lastActiveTimestamp = allActivityTimestamps.length > 0
        ? Math.max(...allActivityTimestamps)
        : null

      const uniqueClients = new Set(feedbackEntries.map((entry) => entry.clientAddress)).size
      const responseFeedbackPairCount = new Set(responseEntries.map((entry) =>
        `${entry.clientAddress}:${entry.feedbackIndex}`
      )).size

      const registrationTimestamp = toTimestampMs(registration.timestamp)
      const firstFeedbackTimestamp = feedbackRowsSortedByTime.length > 0
        ? toTimestampMs(feedbackRowsSortedByTime[0].timestamp)
        : null

      const revocationLatencyHours: number[] = []
      for (const feedback of feedbackEntries) {
        if (!feedback.revoked || feedback.revokedAt === null) continue
        const deltaMs = feedback.revokedAt - feedback.timestamp
        if (deltaMs >= 0) revocationLatencyHours.push(deltaMs / (1000 * 60 * 60))
      }

      const responseLatencyHours: number[] = []
      for (const feedback of feedbackEntries) {
        const firstResponseAt = firstResponseAtMap.get(feedback.feedbackId)
        if (firstResponseAt === undefined) continue
        const deltaMs = firstResponseAt - feedback.timestamp
        if (deltaMs >= 0) responseLatencyHours.push(deltaMs / (1000 * 60 * 60))
      }

      const trustNetwork = await buildNetworkGraph({
        chainId,
        agentId: parsedAgentId,
        limit: 500,
      })

      const connectedBuilderCount = trustNetwork.nodes.filter((node) => node.kind === 'address').length

      const ownershipHistory = transferRows.map((row) => {
        const rowArgs = row.eventArgs as Record<string, unknown>
        const fromAddress = toLowerAddress(rowArgs['from'])
        return {
          fromAddress,
          toAddress: toLowerAddress(rowArgs['to']),
          eventType: fromAddress === '0x0000000000000000000000000000000000000000' ? 'mint' : 'transfer',
          timestamp: toTimestampMs(row.timestamp),
          txHash: row.txHash,
        }
      })

      const uriHistory = uriRows.map((row) => {
        const rowArgs = row.eventArgs as Record<string, unknown>
        return {
          uri: toStringValue(rowArgs['newURI']),
          updatedBy: toLowerAddress(rowArgs['updatedBy']),
          timestamp: toTimestampMs(row.timestamp),
          txHash: row.txHash,
        }
      })

      const metadataHistory = metadataRows.map((row) => {
        const rowArgs = row.eventArgs as Record<string, unknown>
        return {
          key: toStringValue(rowArgs['metadataKey']),
          value: toStringValue(rowArgs['metadataValue']),
          currentValue: toStringValue(rowArgs['metadataValue']),
          timestamp: toTimestampMs(row.timestamp),
          txHash: row.txHash,
        }
      })

      const transactionRows = [
        registration,
        ...feedbackRows,
        ...responseRows,
        ...revocationRows,
        ...transferRows,
        ...uriRows,
        ...metadataRows,
      ]
      const dedupedTxRows = new Map<string, EventFact>()
      for (const row of transactionRows) {
        dedupedTxRows.set(`${row.txHash}:${row.logIndex}`, row)
      }
      const transactionHistory = Array.from(dedupedTxRows.values())
        .sort((a, b) => toTimestampMs(b.timestamp) - toTimestampMs(a.timestamp))
        .slice(0, 100)
        .map((row) => ({
          eventName: row.eventName,
          txHash: row.txHash,
          timestamp: toTimestampMs(row.timestamp),
          summary: describeEvent(row.eventName, row.eventArgs as Record<string, unknown>),
        }))

      let payoutWallet: string | null = null
      for (const row of metadataRows) {
        const rowArgs = row.eventArgs as Record<string, unknown>
        const key = toStringValue(rowArgs['metadataKey']).toLowerCase()
        if (key !== 'agentwallet') continue
        const value = toStringValue(rowArgs['metadataValue']).toLowerCase()
        if (/^0x[0-9a-f]{40}$/.test(value)) {
          payoutWallet = value
          break
        }
        if (/^0x[0-9a-f]{64}$/.test(value)) {
          payoutWallet = `0x${value.slice(-40)}`
          break
        }
      }

      const tags = Array.from(new Set(
        feedbackEntries.flatMap((entry) => [entry.tag1, entry.tag2]).filter((value) => value.length > 0)
      ))

      const agentSummary: AgentSummaryDto = {
        chainId,
        agentId,
        ownerAddress,
        originalRegistrant: toLowerAddress(args['owner']),
        agentUri: currentUri,
        name: `Agent ${agentId}`,
        description: '',
        imageUrl: null,
        tags,
        services: [],
        x402Support: false,
        registrationTxHash: registration.txHash,
        registrationTimestamp,
        hasBeenTransferred: transferCount > 0,
        transferCount,
        feedbackCount: feedbackEntries.length,
        responseCount: responseEntries.length,
        averageReputation,
        lastActiveTimestamp,
      }

      const recencyBiasDays = lastActiveTimestamp !== null
        ? (Date.now() - lastActiveTimestamp) / (1000 * 60 * 60 * 24)
        : null
      const timeToFirstFeedbackDays = firstFeedbackTimestamp !== null
        ? (firstFeedbackTimestamp - registrationTimestamp) / (1000 * 60 * 60 * 24)
        : null

      res.json({
        agent: agentSummary,
        payoutWallet,
        currentUri,
        reputationSummary: {
          count: feedbackEntries.length,
          summaryValue: averageReputation ?? 0,
          summaryValueDecimals: 0,
        },
        feedback: paginatedResult(
          feedbackEntries.slice(0, 25),
          1,
          25,
          feedbackEntries.length,
        ),
        responses: paginatedResult(
          responseEntries.slice(0, 25),
          1,
          25,
          responseEntries.length,
        ),
        ownershipHistory,
        uriHistory,
        metadataHistory,
        transactionHistory,
        trustNetwork,
        trustMetrics: {
          reciprocalReviewRatio: trustNetwork.metrics.reciprocalReviewRatioGlobal,
          closedClusterRatio: trustNetwork.metrics.isolatedClusterShare,
          connectedBuilderCount,
        },
        heuristics: {
          reputationScore: averageReputation,
          clientDiversity: feedbackEntries.length > 0 ? uniqueClients / feedbackEntries.length : null,
          revocationRate: feedbackEntries.length > 0 ? revocationRows.length / feedbackEntries.length : null,
          responseRate: feedbackEntries.length > 0 ? responseFeedbackPairCount / feedbackEntries.length : null,
          recencyBiasDays,
          timeToFirstFeedbackDays,
          averageRevocationLatencyHours: average(revocationLatencyHours),
          averageResponseLatencyHours: average(responseLatencyHours),
          integrityPassRate: null,
          feedbackBurstRatio30d: calcFeedbackBurstRatio30d(feedbackRows),
          reciprocalReviewRatio: trustNetwork.metrics.reciprocalReviewRatioGlobal,
          closedClusterRatio: trustNetwork.metrics.isolatedClusterShare,
          connectedBuilderCount,
        },
      })
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch agent' })
    }
  })

  return router
}
