import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEventDb } = vi.hoisted(() => {
  const mockEventDb = {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
  }
  return { mockEventDb }
})

vi.mock('../src/repositories/event.repository', () => ({
  getEventFactClient: vi.fn().mockResolvedValue(mockEventDb),
}))

vi.mock('../src/repositories/transaction.repository', () => ({
  getTxFactClient: vi.fn().mockResolvedValue({}),
}))

vi.mock('../src/repositories/graph.repository', () => ({
  getReviewEdgeClient: vi.fn().mockResolvedValue({}),
  getRegistrantEdgeClient: vi.fn().mockResolvedValue({}),
  getAgentReviewEdgeClient: vi.fn().mockResolvedValue({}),
  getResponseEdgeClient: vi.fn().mockResolvedValue({}),
}))

import { getAnalyticsOverview } from '../src/services/analytics.service'

describe('getAnalyticsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all zero metrics when database is empty', async () => {
    mockEventDb.count.mockResolvedValue(0)
    mockEventDb.aggregate.mockResolvedValue([])

    const result = await getAnalyticsOverview(1)

    expect(result.totalAgents).toBe(0)
    expect(result.newAgents24h).toBe(0)
    expect(result.newAgents7d).toBe(0)
    expect(result.newAgents30d).toBe(0)
    expect(result.totalFeedback).toBe(0)
    expect(result.activeFeedback).toBe(0)
    expect(result.uniqueClients).toBe(0)
    expect(result.totalResponses).toBe(0)
    expect(result.agentTransfers).toBe(0)
    expect(result.ecosystemGrowthVelocity).toBeNull()
    expect(result.feedbackDensity).toBeNull()
    expect(result.revocationRate).toBeNull()
    expect(result.dormantAgentRatio).toBeNull()
    expect(result.responseEngagementRate).toBeNull()
    expect(result.transferRate).toBeNull()
  })

  it('computes metrics with populated data', async () => {
    // count() is called 11 times in parallel:
    // totalAgents, newAgents24h, newAgents7d, newAgents30d, totalFeedback,
    // totalRevocations, totalResponses, totalTransfers,
    // agents24hPrev, agents7dPrev, agents30dPrev
    mockEventDb.count
      .mockResolvedValueOnce(100) // totalAgents (Registered)
      .mockResolvedValueOnce(5)   // newAgents24h
      .mockResolvedValueOnce(20)  // newAgents7d
      .mockResolvedValueOnce(50)  // newAgents30d
      .mockResolvedValueOnce(200) // totalFeedback (NewFeedback)
      .mockResolvedValueOnce(10)  // totalRevocations (FeedbackRevoked)
      .mockResolvedValueOnce(50)  // totalResponses (ResponseAppended)
      .mockResolvedValueOnce(30)  // totalTransfers (Transfer)
      .mockResolvedValueOnce(3)   // agents24hPrev
      .mockResolvedValueOnce(15)  // agents7dPrev
      .mockResolvedValueOnce(40)  // agents30dPrev

    // aggregate() is called 6 times:
    // mintTransfers, uniqueClients, agentFeedbackLatest,
    // feedbackCountsByWindow, responsePairsLatest, transferLatest
    const agentFeedbackLatest = Array.from({ length: 60 }, (_, i) => ({ _id: i, lastTs: 0 }))
    const responsePairsLatest = Array.from({ length: 40 }, (_, i) => ({ _id: i, lastTs: 0 }))
    const transferLatest = Array.from({ length: 8 }, (_, i) => ({ _id: i, lastTs: 0 }))

    mockEventDb.aggregate
      .mockResolvedValueOnce([{ count: 20 }])  // mintTransfers → 20 mints
      .mockResolvedValueOnce([{ count: 75 }])  // uniqueClients
      .mockResolvedValueOnce(agentFeedbackLatest) // per-agent latest feedback ts
      .mockResolvedValueOnce([{ _id: null, d24h: 10, d7d: 80, d30d: 150 }]) // feedbackCountsByWindow
      .mockResolvedValueOnce(responsePairsLatest) // per-feedback latest response ts
      .mockResolvedValueOnce(transferLatest)      // per-agent latest transfer ts

    const result = await getAnalyticsOverview(1)

    expect(result.totalAgents).toBe(100)
    expect(result.newAgents24h).toBe(5)
    expect(result.newAgents7d).toBe(20)
    expect(result.newAgents30d).toBe(50)
    expect(result.totalFeedback).toBe(200)
    expect(result.activeFeedback).toBe(190) // 200 - 10
    expect(result.uniqueClients).toBe(75)
    expect(result.totalResponses).toBe(50)
    expect(result.agentTransfers).toBe(10) // 30 - 20 mints

    // ecosystemGrowthVelocity = (20 - 15) / 7
    expect(result.ecosystemGrowthVelocity).toBeCloseTo(5 / 7)

    // feedbackDensity = 200 / 100
    expect(result.feedbackDensity).toBe(2)

    // revocationRate = 10 / 200
    expect(result.revocationRate).toBe(0.05)

    // dormantAgentRatio = (100 - 60) / 100
    expect(result.dormantAgentRatio).toBe(0.4)

    // responseEngagementRate = 40 / 200
    expect(result.responseEngagementRate).toBe(0.2)

    // transferRate = 8 / 100
    expect(result.transferRate).toBe(0.08)

    // windowedHeuristics should be present
    expect(result.windowedHeuristics).toBeDefined()
    expect(result.windowedHeuristics.ecosystemGrowthVelocity).toHaveProperty('d24h')
    expect(result.windowedHeuristics.ecosystemGrowthVelocity).toHaveProperty('d7d')
    expect(result.windowedHeuristics.ecosystemGrowthVelocity).toHaveProperty('d30d')
  })
})
