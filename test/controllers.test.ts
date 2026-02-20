import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Router, Request, Response } from 'express'

const { mockEventDb, mockTxDb, mockCallDb, mockGraphDbs } = vi.hoisted(() => {
  const mockEventDb = {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
  }
  const mockTxDb = {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
  }
  const mockCallDb = {
    findOne: vi.fn().mockResolvedValue(null),
  }
  const mockGraphDbs = {
    agentReview: { find: vi.fn().mockResolvedValue([]) },
    registrant: { find: vi.fn().mockResolvedValue([]) },
    response: { find: vi.fn().mockResolvedValue([]) },
    review: { find: vi.fn().mockResolvedValue([]) },
  }
  return { mockEventDb, mockTxDb, mockCallDb, mockGraphDbs }
})

vi.mock('../src/repositories/event.repository', () => ({
  getEventFactClient: vi.fn().mockResolvedValue(mockEventDb),
}))

vi.mock('../src/repositories/transaction.repository', () => ({
  getTxFactClient: vi.fn().mockResolvedValue(mockTxDb),
  getCallFactClient: vi.fn().mockResolvedValue(mockCallDb),
}))

vi.mock('../src/repositories/chain-state.repository', () => ({
  getChainSyncState: vi.fn().mockResolvedValue({
    chainId: 1,
    network: 'mainnet',
    lastSyncedBlock: 100,
    lastSyncedBlockHash: '0xabc',
    updatedAt: Date.now(),
  }),
}))

vi.mock('../src/repositories/graph.repository', () => ({
  getReviewEdgeClient: vi.fn().mockResolvedValue(mockGraphDbs.review),
  getRegistrantEdgeClient: vi.fn().mockResolvedValue(mockGraphDbs.registrant),
  getAgentReviewEdgeClient: vi.fn().mockResolvedValue(mockGraphDbs.agentReview),
  getResponseEdgeClient: vi.fn().mockResolvedValue(mockGraphDbs.response),
}))

vi.mock('../src/services/analytics.service', () => ({
  getAnalyticsOverview: vi.fn().mockResolvedValue({
    totalAgents: 50,
    newAgents24h: 3,
    newAgents7d: 10,
    newAgents30d: 30,
    totalFeedback: 100,
    activeFeedback: 90,
    uniqueClients: 40,
    totalResponses: 25,
    agentTransfers: 5,
    ecosystemGrowthVelocity: 0.5,
    feedbackDensity: 2,
    revocationRate: 0.1,
    dormantAgentRatio: 0.3,
    responseEngagementRate: 0.25,
    transferRate: 0.1,
  }),
}))

vi.mock('../src/utils/logger', () => ({
  log: vi.fn(),
}))

import { createHealthRouter } from '../src/controllers/health.controller'
import { createAnalyticsRouter } from '../src/controllers/analytics.controller'
import { createTransactionsRouter } from '../src/controllers/transactions.controller'
import { createSearchRouter } from '../src/controllers/search.controller'
import { createNetworkRouter } from '../src/controllers/network.controller'
import { createAgentsRouter } from '../src/controllers/agents.controller'
import { createAddressesRouter } from '../src/controllers/addresses.controller'
import { createReputationRouter } from '../src/controllers/reputation.controller'

type HttpMethod = 'get' | 'post' | 'put' | 'delete'

function getRouteHandler(router: Router, method: HttpMethod, path: string): (req: Request, res: Response) => Promise<void> | void {
  const stack = (router as unknown as { stack: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: (req: Request, res: Response) => Promise<void> | void }> } }> }).stack
  const layer = stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method])
  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error(`Route not found for ${method.toUpperCase()} ${path}`)
  }
  return layer.route.stack[0].handle
}

async function invokeRoute(
  router: Router,
  method: HttpMethod,
  path: string,
  options: {
    params?: Record<string, string>
    query?: Record<string, unknown>
    body?: Record<string, unknown>
  } = {},
): Promise<{ status: number; body: unknown }> {
  const handler = getRouteHandler(router, method, path)

  const req = {
    params: options.params ?? {},
    query: options.query ?? {},
    body: options.body ?? {},
  } as unknown as Request

  const responseState: { statusCode: number; payload: unknown } = {
    statusCode: 200,
    payload: undefined,
  }

  const res = {
    status(code: number) {
      responseState.statusCode = code
      return this
    },
    json(payload: unknown) {
      responseState.payload = payload
      return this
    },
  } as unknown as Response

  await handler(req, res)
  return {
    status: responseState.statusCode,
    body: responseState.payload,
  }
}

function resetMocks() {
  mockEventDb.find.mockReset().mockResolvedValue([])
  mockEventDb.findOne.mockReset().mockResolvedValue(null)
  mockEventDb.count.mockReset().mockResolvedValue(0)
  mockEventDb.aggregate.mockReset().mockResolvedValue([])
  mockTxDb.find.mockReset().mockResolvedValue([])
  mockTxDb.findOne.mockReset().mockResolvedValue(null)
  mockTxDb.count.mockReset().mockResolvedValue(0)
  mockCallDb.findOne.mockReset().mockResolvedValue(null)
  mockGraphDbs.agentReview.find.mockReset().mockResolvedValue([])
  mockGraphDbs.registrant.find.mockReset().mockResolvedValue([])
  mockGraphDbs.response.find.mockReset().mockResolvedValue([])
  mockGraphDbs.review.find.mockReset().mockResolvedValue([])
}

describe('Health Controller', () => {
  beforeEach(() => resetMocks())

  it('GET / returns health status', async () => {
    const router = createHealthRouter({
      getLatestBlockNumber: vi.fn().mockResolvedValue(105),
    } as any)

    const res = await invokeRoute(router, 'get', '/')
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.lastSyncedBlock).toBe(100)
    expect(body.latestChainBlock).toBe(105)
  })
})

describe('Analytics Controller', () => {
  beforeEach(() => resetMocks())

  it('GET /overview returns canonical analytics payload', async () => {
    const router = createAnalyticsRouter()
    const res = await invokeRoute(router, 'get', '/overview')
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect((body.dashboardMetrics as Record<string, unknown>).totalRegisteredAgents).toBe(50)
    expect(Array.isArray((body as { activityFeed: unknown[] }).activityFeed)).toBe(true)
    expect(Array.isArray((body.charts as Record<string, unknown>).registrations as unknown[])).toBe(true)
  })
})

describe('Transactions Controller', () => {
  beforeEach(() => resetMocks())

  it('GET /:txHash returns 400 for invalid hash', async () => {
    const router = createTransactionsRouter()
    const res = await invokeRoute(router, 'get', '/:txHash', { params: { txHash: 'not-a-hash' } })
    expect(res.status).toBe(400)
  })

  it('GET /:txHash returns transaction detail', async () => {
    const router = createTransactionsRouter()
    const txHash = '0x' + 'b'.repeat(64)
    mockTxDb.findOne.mockResolvedValueOnce({ id: `1:${txHash}`, txHash, blockNumber: 50 })
    mockCallDb.findOne.mockResolvedValueOnce({ functionName: 'register', functionSignature: 'register(string)', rawArgs: {}, normalizedArgs: {} })
    mockEventDb.find.mockResolvedValueOnce([{ eventName: 'Registered', logIndex: 0 }])

    const res = await invokeRoute(router, 'get', '/:txHash', { params: { txHash } })
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect((body.transactionFact as Record<string, unknown>).txHash).toBe(txHash)
    expect((body.callFact as Record<string, unknown>).functionName).toBe('register')
  })
})

describe('Search Controller', () => {
  beforeEach(() => resetMocks())

  it('GET / returns 400 when q is missing', async () => {
    const router = createSearchRouter()
    const res = await invokeRoute(router, 'get', '/', { query: {} })
    expect(res.status).toBe(400)
  })

  it('GET / returns paginated search results', async () => {
    const router = createSearchRouter()
    mockEventDb.findOne.mockResolvedValueOnce({
      eventName: 'Registered',
      blockNumber: 10,
      eventArgs: { agentId: 7 },
    })

    const res = await invokeRoute(router, 'get', '/', { query: { q: '7' } })
    const body = res.body as Record<string, unknown>
    const results = (body.results as Record<string, unknown>).items as unknown[]

    expect(res.status).toBe(200)
    expect(body.query).toBe('7')
    expect(Array.isArray(results)).toBe(true)
    expect((results[0] as Record<string, unknown>).type).toBe('agent')
  })
})

describe('Network Controller', () => {
  beforeEach(() => resetMocks())

  it('GET /graph returns graph payload with nodes, edges, and truncation meta', async () => {
    const router = createNetworkRouter()
    mockGraphDbs.review.find.mockResolvedValueOnce([
      {
        clientAddress: '0x1111111111111111111111111111111111111111',
        targetAgentId: 2,
        timestamp: 1000,
        txHash: '0xaaa',
      },
    ])
    mockGraphDbs.registrant.find.mockResolvedValueOnce([])
    mockGraphDbs.agentReview.find.mockResolvedValueOnce([])
    mockGraphDbs.response.find.mockResolvedValueOnce([])

    const res = await invokeRoute(router, 'get', '/graph')
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(Array.isArray(body.nodes as unknown[])).toBe(true)
    expect(Array.isArray(body.edges as unknown[])).toBe(true)
    expect((body.meta as Record<string, unknown>).edgeLimitApplied).toBeDefined()
    expect(typeof (body.meta as Record<string, unknown>).truncated).toBe('boolean')
  })

  it('GET /graph returns 400 when global window exceeds 14 days', async () => {
    const router = createNetworkRouter()
    const res = await invokeRoute(router, 'get', '/graph', {
      query: {
        since: 1,
        until: (15 * 24 * 60 * 60) + 1,
      },
    })

    expect(res.status).toBe(400)
    expect((res.body as Record<string, unknown>).error).toBeDefined()
  })
})

describe('Agents Controller', () => {
  beforeEach(() => resetMocks())

  it('GET / returns paginated items/meta', async () => {
    const router = createAgentsRouter()
    mockEventDb.find.mockResolvedValueOnce([
      {
        eventName: 'Registered',
        txHash: '0xtx',
        timestamp: 1700000000000,
        eventArgs: { agentId: 1, owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', agentURI: 'ipfs://a' },
      },
    ])

    const res = await invokeRoute(router, 'get', '/')
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(Array.isArray(body.items as unknown[])).toBe(true)
    expect((body.meta as Record<string, unknown>).page).toBe(1)
  })

  it('GET /:agentId returns canonical profile response', async () => {
    const router = createAgentsRouter()
    mockEventDb.findOne.mockResolvedValueOnce({
      eventName: 'Registered',
      txHash: '0xreg',
      timestamp: 1700000000000,
      eventArgs: { agentId: 100, owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', agentURI: 'ipfs://agent' },
    })
    mockEventDb.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokeRoute(router, 'get', '/:agentId', { params: { agentId: '100' } })
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect((body.agent as Record<string, unknown>).agentId).toBe('100')
    expect((body.feedback as Record<string, unknown>).items).toBeDefined()
  })
})

describe('Addresses Controller', () => {
  beforeEach(() => resetMocks())

  it('GET /:address returns 400 for invalid address', async () => {
    const router = createAddressesRouter()
    const res = await invokeRoute(router, 'get', '/:address', { params: { address: 'not-an-address' } })
    expect(res.status).toBe(400)
  })

  it('GET /:address returns canonical address profile', async () => {
    const router = createAddressesRouter()
    const addr = '0x' + 'a'.repeat(40)
    mockEventDb.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockEventDb.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockEventDb.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)

    const res = await invokeRoute(router, 'get', '/:address', { params: { address: addr } })
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.address).toBe(addr)
    expect(body.owner).toBeDefined()
  })
})

describe('Reputation Controller', () => {
  beforeEach(() => resetMocks())

  it('GET / returns canonical global reputation payload', async () => {
    const router = createReputationRouter()
    mockEventDb.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(25)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(25)
    mockEventDb.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockEventDb.aggregate
      .mockResolvedValueOnce([{ count: 30 }])
      .mockResolvedValueOnce([{ count: 50 }])
      .mockResolvedValueOnce([{ count: 10 }])
      .mockResolvedValueOnce([{ _id: '0xabc', count: 8 }])
      .mockResolvedValueOnce([{ _id: '42', count: 7 }])
      .mockResolvedValueOnce([{ _id: '0xdef', count: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokeRoute(router, 'get', '/')
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect((body.metrics as Record<string, unknown>).totalFeedbackEntries).toBe(100)
    expect((body.recentFeedback as Record<string, unknown>).meta).toBeDefined()
  })

  it('GET /:agentId returns canonical agent reputation payload', async () => {
    const router = createReputationRouter()
    mockEventDb.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
    mockEventDb.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockEventDb.aggregate
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ _id: '0xabc', count: 4 }])
      .mockResolvedValueOnce([{ _id: '0xdef', count: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokeRoute(router, 'get', '/:agentId', { params: { agentId: '42' } })
    const body = res.body as Record<string, unknown>

    expect(res.status).toBe(200)
    expect((body.metrics as Record<string, unknown>).totalFeedbackEntries).toBe(10)
    expect((body.metrics as Record<string, unknown>).mostReviewedAgent).toBe('42')
  })
})
