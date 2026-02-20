import { Router, Request, Response } from 'express'
import type { Document } from 'mongodb'
import { getAnalyticsOverview } from '../services/analytics.service'
import { getEventFactClient } from '../repositories/event.repository'
import { env } from '../env'

export function createAnalyticsRouter(): Router {
  const router = Router()

  /**
   * GET /v1/analytics/overview
   * Dashboard analytics overview with metrics and heuristics.
   */
  router.get('/overview', async (req: Request, res: Response) => {
    try {
      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const [overview, eventDb] = await Promise.all([
        getAnalyticsOverview(chainId),
        getEventFactClient(),
      ])

      const [registrations, feedbackVolume, responseVolume, revocationVolume, transferVolume, topAgentsByFeedback, activityEvents] = await Promise.all([
        buildDailySeries(eventDb, { chainId, eventName: 'Registered' }),
        buildDailySeries(eventDb, { chainId, eventName: 'NewFeedback' }),
        buildDailySeries(eventDb, { chainId, eventName: 'ResponseAppended' }),
        buildDailySeries(eventDb, { chainId, eventName: 'FeedbackRevoked' }),
        buildDailySeries(eventDb, {
          chainId,
          eventName: 'Transfer',
          'eventArgs.from': { $ne: '0x0000000000000000000000000000000000000000' },
        }),
        eventDb.aggregate<{ _id: unknown; count: number }>([
          { $match: { chainId, eventName: 'NewFeedback' } },
          { $group: { _id: '$eventArgs.agentId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        eventDb.find({ chainId }, { blockNumber: -1, logIndex: -1 }, 25),
      ])

      // Enrich top agents with URI, reputation score, and client diversity
      const validTopAgents = topAgentsByFeedback.filter(
        (row) => row._id !== null && row._id !== undefined,
      )
      // Preserve raw _id values (numbers in MongoDB) for $in queries
      const topAgentRawIds = validTopAgents.map((row) => row._id)

      const [topAgentFeedbackStats, topAgentLatestUris, topAgentRegistrationUris] = topAgentRawIds.length > 0
        ? await Promise.all([
          // Per-agent feedback stats: average reputation (normalized value) + unique client count
          eventDb.aggregate<{ _id: unknown; avg: number; clients: string[] }>([
            { $match: { chainId, eventName: 'NewFeedback', 'eventArgs.agentId': { $in: topAgentRawIds } } },
            {
              $project: {
                agentId: '$eventArgs.agentId',
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
                clientAddress: '$eventArgs.clientAddress',
              },
            },
            {
              $group: {
                _id: '$agentId',
                avg: { $avg: '$normalizedValue' },
                clients: { $addToSet: '$clientAddress' },
              },
            },
          ]),
          // Latest URI from URIUpdated events
          eventDb.aggregate<{ _id: unknown; uri: string }>([
            { $match: { chainId, eventName: 'URIUpdated', 'eventArgs.agentId': { $in: topAgentRawIds } } },
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
          // Fallback URI from Registered events
          eventDb.aggregate<{ _id: unknown; uri: string }>([
            { $match: { chainId, eventName: 'Registered', 'eventArgs.agentId': { $in: topAgentRawIds } } },
            { $group: { _id: '$eventArgs.agentId', uri: { $first: '$eventArgs.agentURI' } } },
          ]),
        ])
        : [[], [], []]

      const feedbackStatsMap = new Map<string, { avg: number; uniqueClients: number; feedbackCount: number }>()
      for (const row of topAgentFeedbackStats) {
        const key = String(row._id)
        feedbackStatsMap.set(key, {
          avg: Number.isFinite(row.avg) ? row.avg : 0,
          uniqueClients: Array.isArray(row.clients) ? row.clients.length : 0,
          feedbackCount: Array.isArray(row.clients) ? row.clients.length : 0,
        })
      }

      const uriUpdateMap = new Map<string, string>()
      for (const row of topAgentLatestUris) {
        uriUpdateMap.set(String(row._id), String(row.uri ?? ''))
      }

      const registrationUriMap = new Map<string, string>()
      for (const row of topAgentRegistrationUris) {
        registrationUriMap.set(String(row._id), String(row.uri ?? ''))
      }

      const enrichedTopAgents = validTopAgents.map((row) => {
        const agentId = String(row._id)
        const stats = feedbackStatsMap.get(agentId)
        const agentUri = uriUpdateMap.get(agentId) ?? registrationUriMap.get(agentId) ?? ''
        const feedbackCount = row.count
        const uniqueClients = stats?.uniqueClients ?? 0

        return {
          agentId,
          value: feedbackCount,
          agentUri,
          reputationScore: stats?.avg ?? null,
          clientDiversity: feedbackCount > 0 ? uniqueClients / feedbackCount : null,
        }
      })

      const payload = {
        dashboardMetrics: {
          totalRegisteredAgents: overview.totalAgents,
          newAgents24h: overview.newAgents24h,
          newAgents7d: overview.newAgents7d,
          newAgents30d: overview.newAgents30d,
          totalFeedbackSubmitted: overview.totalFeedback,
          activeFeedback: overview.activeFeedback,
          uniqueClientAddresses: overview.uniqueClients,
          totalResponsesAppended: overview.totalResponses,
          agentTransfers: overview.agentTransfers,
        },
        heuristics: {
          ecosystemGrowthVelocity: overview.ecosystemGrowthVelocity,
          feedbackDensity: overview.feedbackDensity,
          revocationRate: overview.revocationRate,
          dormantAgentRatio: overview.dormantAgentRatio,
          responseEngagementRate: overview.responseEngagementRate,
          transferRate: overview.transferRate,
          networkGiniCoefficient: null,
          responderConcentration: null,
        },
        windowedHeuristics: overview.windowedHeuristics,
        charts: {
          registrations,
          feedbackVolume,
          responseVolume,
          revocationVolume,
          activeAgents: [],
          clientGrowth: [],
          responderGrowth: [],
          transferVolume,
          integrityHealth: [],
          topAgentsByFeedback: enrichedTopAgents,
          tagHeatmap: [],
          endpointHeatmap: [],
          protocolDistribution: [],
          timeToFirstFeedbackDistribution: [],
          selectedAgentFeedbackVelocity: [],
        },
        activityFeed: activityEvents.map((evt) => {
          const eventArgs = (evt.eventArgs ?? {}) as Record<string, unknown>
          const candidateAgentId = eventArgs['agentId'] ?? eventArgs['tokenId']
          const agentId = (
            typeof candidateAgentId === 'string' || typeof candidateAgentId === 'number'
          )
            ? String(candidateAgentId)
            : null

          return {
            eventName: evt.eventName,
            agentId,
            txHash: evt.txHash,
            timestamp: toTimestampMs(evt.timestamp),
            summary: buildEventSummary(evt.eventName, eventArgs),
          }
        }),
      }

      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: 'Failed to compute analytics' })
    }
  })

  return router
}

function toTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value < 1_000_000_000_000) {
      return value * 1000
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      if (parsed > 0 && parsed < 1_000_000_000_000) {
        return parsed * 1000
      }
      return parsed
    }
  }

  return 0
}

async function buildDailySeries(
  eventDb: Awaited<ReturnType<typeof getEventFactClient>>,
  match: Document,
): Promise<Array<{ timestamp: number; value: number; label: string }>> {
  const rows = await eventDb.aggregate<{ _id: string; value: number; minTs: number }>([
    { $match: match },
    {
      $project: {
        timestampMs: {
          $cond: [
            { $lt: ['$timestamp', 1_000_000_000_000] },
            { $multiply: ['$timestamp', 1000] },
            '$timestamp',
          ],
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: { $toDate: '$timestampMs' },
          },
        },
        value: { $sum: 1 },
        minTs: { $min: '$timestampMs' },
      },
    },
    { $sort: { _id: 1 } },
  ])

  return rows.map((row) => ({
    timestamp: row.minTs,
    value: row.value,
    label: row._id,
  }))
}

function buildEventSummary(eventName: string, eventArgs: Record<string, unknown>): string {
  if (eventName === 'Registered') {
    return `Registered by ${String(eventArgs['owner'] ?? 'unknown')}`
  }

  if (eventName === 'NewFeedback') {
    return `Feedback from ${String(eventArgs['clientAddress'] ?? 'unknown')}`
  }

  if (eventName === 'ResponseAppended') {
    return `Response by ${String(eventArgs['responder'] ?? 'unknown')}`
  }

  if (eventName === 'FeedbackRevoked') {
    return `Feedback revoked by ${String(eventArgs['clientAddress'] ?? 'unknown')}`
  }

  if (eventName === 'Transfer') {
    return `Transfer ${String(eventArgs['from'] ?? '')} -> ${String(eventArgs['to'] ?? '')}`
  }

  if (eventName === 'URIUpdated') {
    return `URI updated by ${String(eventArgs['updatedBy'] ?? 'unknown')}`
  }

  if (eventName === 'MetadataSet') {
    return `Metadata key ${String(eventArgs['metadataKey'] ?? 'unknown')}`
  }

  return 'Event observed'
}
