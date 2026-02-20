import type { Document } from 'mongodb'
import { getEventFactClient } from '../repositories/event.repository'
import type { AnalyticsOverview, WindowedValue } from '../types/api'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Compute the analytics overview for the dashboard.
 */
export async function getAnalyticsOverview(chainId: number): Promise<AnalyticsOverview> {
  const eventDb = await getEventFactClient()

  const now = Date.now()
  const d24h = now - 86_400_000
  const d48h = now - 2 * 86_400_000
  const d7d = now - 7 * 86_400_000
  const d14d = now - 14 * 86_400_000
  const d30d = now - 30 * 86_400_000
  const d60d = now - 60 * 86_400_000

  const baseFilter = { chainId }

  // Count events by name + windowed registration counts for growth velocity
  const [
    totalAgents,
    newAgents24h,
    newAgents7d,
    newAgents30d,
    totalFeedback,
    totalRevocations,
    totalResponses,
    totalTransfers,
    agents24hPrev,
    agents7dPrev,
    agents30dPrev,
  ] = await Promise.all([
    eventDb.count({ ...baseFilter, eventName: 'Registered' }),
    eventDb.count({ ...baseFilter, eventName: 'Registered', timestamp: { $gte: d24h } } as Document),
    eventDb.count({ ...baseFilter, eventName: 'Registered', timestamp: { $gte: d7d } } as Document),
    eventDb.count({ ...baseFilter, eventName: 'Registered', timestamp: { $gte: d30d } } as Document),
    eventDb.count({ ...baseFilter, eventName: 'NewFeedback' }),
    eventDb.count({ ...baseFilter, eventName: 'FeedbackRevoked' }),
    eventDb.count({ ...baseFilter, eventName: 'ResponseAppended' }),
    eventDb.count({ ...baseFilter, eventName: 'Transfer' }),
    eventDb.count({ ...baseFilter, eventName: 'Registered', timestamp: { $gte: d48h, $lt: d24h } } as Document),
    eventDb.count({ ...baseFilter, eventName: 'Registered', timestamp: { $gte: d14d, $lt: d7d } } as Document),
    eventDb.count({ ...baseFilter, eventName: 'Registered', timestamp: { $gte: d60d, $lt: d30d } } as Document),
  ])

  // Parallel batch: non-mint transfers, unique clients, windowed aggregations
  const [
    mintTransfers,
    uniqueClientsResult,
    agentFeedbackLatest,
    feedbackCountsByWindow,
    responsePairsLatest,
    transferLatest,
  ] = await Promise.all([
    // Non-mint transfer count
    eventDb.aggregate<{ count: number }>([
      { $match: { chainId, eventName: 'Transfer', 'eventArgs.from': ZERO_ADDRESS } },
      { $count: 'count' },
    ]),
    // Unique clients
    eventDb.aggregate<{ count: number }>([
      { $match: { chainId, eventName: 'NewFeedback' } },
      { $group: { _id: '$eventArgs.clientAddress' } },
      { $count: 'count' },
    ]),
    // Per-agent latest feedback timestamp (replaces agentsWithFeedback count query)
    eventDb.aggregate<{ _id: unknown; lastTs: number }>([
      { $match: { chainId, eventName: 'NewFeedback' } },
      { $group: { _id: '$eventArgs.agentId', lastTs: { $max: '$timestamp' } } },
    ]),
    // Windowed feedback counts in a single scan
    eventDb.aggregate<{ _id: null; d24h: number; d7d: number; d30d: number }>([
      { $match: { chainId, eventName: 'NewFeedback' } },
      {
        $group: {
          _id: null,
          d24h: { $sum: { $cond: [{ $gte: ['$timestamp', d24h] }, 1, 0] } },
          d7d: { $sum: { $cond: [{ $gte: ['$timestamp', d7d] }, 1, 0] } },
          d30d: { $sum: { $cond: [{ $gte: ['$timestamp', d30d] }, 1, 0] } },
        },
      },
    ]),
    // Per-feedback-item latest response timestamp (replaces feedbackWithResponse count query)
    eventDb.aggregate<{ _id: unknown; lastTs: number }>([
      { $match: { chainId, eventName: 'ResponseAppended' } },
      {
        $group: {
          _id: {
            agentId: '$eventArgs.agentId',
            clientAddress: '$eventArgs.clientAddress',
            feedbackIndex: '$eventArgs.feedbackIndex',
          },
          lastTs: { $max: '$timestamp' },
        },
      },
    ]),
    // Per-agent latest non-mint transfer timestamp (replaces agentsTransferred count query)
    eventDb.aggregate<{ _id: unknown; lastTs: number }>([
      { $match: { chainId, eventName: 'Transfer', 'eventArgs.from': { $ne: ZERO_ADDRESS } } },
      { $group: { _id: '$eventArgs.tokenId', lastTs: { $max: '$timestamp' } } },
    ]),
  ])

  const mintCount = mintTransfers[0]?.count ?? 0
  const agentTransfers = totalTransfers - mintCount
  const uniqueClients = uniqueClientsResult[0]?.count ?? 0
  const activeFeedback = totalFeedback - totalRevocations

  // --- Global heuristics (backwards-compatible) ---
  const agentsWithFeedbackCount = agentFeedbackLatest.length
  const feedbackWithResponseCount = responsePairsLatest.length
  const agentsTransferred = transferLatest.length

  const ecosystemGrowthVelocity = totalAgents > 0
    ? (newAgents7d - agents7dPrev) / 7
    : null
  const feedbackDensity = totalAgents > 0 ? totalFeedback / totalAgents : null
  const revocationRate = totalFeedback > 0 ? totalRevocations / totalFeedback : null
  const dormantAgentRatio = totalAgents > 0
    ? (totalAgents - agentsWithFeedbackCount) / totalAgents
    : null
  const responseEngagementRate = totalFeedback > 0
    ? feedbackWithResponseCount / totalFeedback
    : null
  const transferRate = totalAgents > 0 ? agentsTransferred / totalAgents : null

  // --- Windowed heuristics (24h / 7d / 30d) ---
  const fbCounts = feedbackCountsByWindow[0] ?? { d24h: 0, d7d: 0, d30d: 0 }

  const windowedHeuristics = buildWindowedHeuristics(
    totalAgents,
    { d24h: newAgents24h, d7d: newAgents7d, d30d: newAgents30d },
    { d24h: agents24hPrev, d7d: agents7dPrev, d30d: agents30dPrev },
    fbCounts,
    agentFeedbackLatest,
    responsePairsLatest,
    transferLatest,
    { d24h, d7d, d30d },
  )

  return {
    totalAgents,
    newAgents24h,
    newAgents7d,
    newAgents30d,
    totalFeedback,
    activeFeedback,
    uniqueClients,
    totalResponses,
    agentTransfers,
    ecosystemGrowthVelocity,
    feedbackDensity,
    revocationRate,
    dormantAgentRatio,
    responseEngagementRate,
    transferRate,
    windowedHeuristics,
  }
}

function buildWindowedHeuristics(
  totalAgents: number,
  registrations: { d24h: number; d7d: number; d30d: number },
  priorRegistrations: { d24h: number; d7d: number; d30d: number },
  feedbackCounts: { d24h: number; d7d: number; d30d: number },
  agentFeedbackLatest: { _id: unknown; lastTs: number }[],
  responsePairsLatest: { _id: unknown; lastTs: number }[],
  transferLatest: { _id: unknown; lastTs: number }[],
  thresholds: { d24h: number; d7d: number; d30d: number },
): AnalyticsOverview['windowedHeuristics'] {
  function computeWindow(
    windowSince: number,
    windowDays: number,
    regsInWindow: number,
    regsInPriorWindow: number,
    fbCount: number,
  ): {
    ecosystemGrowthVelocity: number | null
    feedbackDensity: number | null
    dormantAgentRatio: number | null
    responseEngagementRate: number | null
    transferRate: number | null
  } {
    const agentsWithFb = agentFeedbackLatest.filter((r) => r.lastTs >= windowSince).length
    const responsePairs = responsePairsLatest.filter((r) => r.lastTs >= windowSince).length
    const transfers = transferLatest.filter((r) => r.lastTs >= windowSince).length

    return {
      ecosystemGrowthVelocity: totalAgents > 0
        ? (regsInWindow - regsInPriorWindow) / windowDays
        : null,
      feedbackDensity: totalAgents > 0 ? fbCount / totalAgents : null,
      dormantAgentRatio: totalAgents > 0
        ? (totalAgents - agentsWithFb) / totalAgents
        : null,
      responseEngagementRate: fbCount > 0 ? responsePairs / fbCount : null,
      transferRate: totalAgents > 0 ? transfers / totalAgents : null,
    }
  }

  const w24h = computeWindow(thresholds.d24h, 1, registrations.d24h, priorRegistrations.d24h, feedbackCounts.d24h)
  const w7d = computeWindow(thresholds.d7d, 7, registrations.d7d, priorRegistrations.d7d, feedbackCounts.d7d)
  const w30d = computeWindow(thresholds.d30d, 30, registrations.d30d, priorRegistrations.d30d, feedbackCounts.d30d)

  return {
    ecosystemGrowthVelocity: { d24h: w24h.ecosystemGrowthVelocity, d7d: w7d.ecosystemGrowthVelocity, d30d: w30d.ecosystemGrowthVelocity },
    feedbackDensity: { d24h: w24h.feedbackDensity, d7d: w7d.feedbackDensity, d30d: w30d.feedbackDensity },
    dormantAgentRatio: { d24h: w24h.dormantAgentRatio, d7d: w7d.dormantAgentRatio, d30d: w30d.dormantAgentRatio },
    responseEngagementRate: { d24h: w24h.responseEngagementRate, d7d: w7d.responseEngagementRate, d30d: w30d.responseEngagementRate },
    transferRate: { d24h: w24h.transferRate, d7d: w7d.transferRate, d30d: w30d.transferRate },
  }
}
