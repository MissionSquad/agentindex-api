import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Router, Request, Response } from 'express'

const {
  mockEventDb,
  mockTxDb,
  mockCallDb,
  mockGraphDbs,
  mockAgentMetadataDb,
  mockGetAgentMetadataBatch,
  mockGetAgentMetadataByAgent,
  mockGetAgentMetadataClient,
} = vi.hoisted(() => {
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
  const mockAgentMetadataDb = {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  }
  const mockGetAgentMetadataBatch = vi.fn().mockResolvedValue([])
  const mockGetAgentMetadataByAgent = vi.fn().mockResolvedValue(null)
  const mockGetAgentMetadataClient = vi.fn().mockResolvedValue(mockAgentMetadataDb)

  return {
    mockEventDb,
    mockTxDb,
    mockCallDb,
    mockGraphDbs,
    mockAgentMetadataDb,
    mockGetAgentMetadataBatch,
    mockGetAgentMetadataByAgent,
    mockGetAgentMetadataClient,
  }
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

vi.mock('../src/repositories/agent-metadata.repository', () => ({
  getAgentMetadataBatch: mockGetAgentMetadataBatch,
  getAgentMetadataByAgent: mockGetAgentMetadataByAgent,
  getAgentMetadataClient: mockGetAgentMetadataClient,
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
  mockAgentMetadataDb.find.mockReset().mockResolvedValue([])
  mockAgentMetadataDb.findOne.mockReset().mockResolvedValue(null)
  mockAgentMetadataDb.count.mockReset().mockResolvedValue(0)
  mockGetAgentMetadataBatch.mockReset().mockResolvedValue([])
  mockGetAgentMetadataByAgent.mockReset().mockResolvedValue(null)
  mockGetAgentMetadataClient.mockReset().mockResolvedValue(mockAgentMetadataDb)
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

  it('GET /agents returns structured metadata search results', async () => {
    const router = createSearchRouter()
    mockAgentMetadataDb.count.mockResolvedValueOnce(1)
    mockAgentMetadataDb.find.mockResolvedValueOnce([
      {
        id: '1:42',
        chainId: 1,
        agentId: 42,
        uri: 'https://example.com/agent.json',
        uriHash: 'hash',
        name: 'Agent Forty Two',
        description: 'MCP and A2A enabled',
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        image: null,
        active: true,
        x402Support: true,
        erc8004Support: null,
        services: ['MCP', 'A2A'],
        registrations: ['eip155:1:0xregistry'],
        supportedTrusts: ['reputation'],
        serviceTools: ['get_portfolio'],
        attributeProtocols: ['morpho'],
        contactEmails: ['support@example.com'],
        contactTwitter: ['https://x.com/example'],
        resolveStatus: 'resolved',
        resolveError: null,
        resolvedAt: 1000,
        eventTimestamp: 1000,
        eventTxHash: '0xtx',
        eventBlockNumber: 10,
      },
    ])

    const res = await invokeRoute(router, 'get', '/agents', {
      query: {
        q: 'portfolio manager',
        service: 'mcp',
        protocol: 'morpho',
        tool: 'get_portfolio',
        email: 'support@example.com',
        x402Support: 'true',
      },
    })

    const body = res.body as Record<string, unknown>
    const results = (body.results as Record<string, unknown>).items as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(body.query).toBe('portfolio manager')
    expect(results).toHaveLength(1)
    expect(results[0].agentId).toBe(42)
    expect(results[0].serviceTools).toEqual(['get_portfolio'])
  })

  it('GET /agents includes raw metadata when includeRaw=true', async () => {
    const router = createSearchRouter()
    mockAgentMetadataDb.count.mockResolvedValueOnce(1)
    mockAgentMetadataDb.find.mockResolvedValueOnce([
      {
        id: '1:7',
        chainId: 1,
        agentId: 7,
        uri: 'https://example.com/agent.json',
        uriHash: 'hash',
        name: 'Agent Seven',
        description: null,
        type: null,
        image: null,
        active: null,
        x402Support: null,
        erc8004Support: null,
        services: [],
        registrations: [],
        supportedTrusts: [],
        rawMetadata: { name: 'Agent Seven', services: [] },
        resolveStatus: 'resolved',
        resolveError: null,
        resolvedAt: 1000,
        eventTimestamp: 1000,
        eventTxHash: '0xtx',
        eventBlockNumber: 10,
      },
    ])

    const res = await invokeRoute(router, 'get', '/agents', {
      query: { includeRaw: 'true' },
    })

    const body = res.body as Record<string, unknown>
    const first = ((body.results as Record<string, unknown>).items as Array<Record<string, unknown>>)[0]
    expect(res.status).toBe(200)
    expect(first.rawMetadata).toEqual({ name: 'Agent Seven', services: [] })
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
    mockGetAgentMetadataByAgent.mockResolvedValueOnce({
      id: '1:100',
      chainId: 1,
      agentId: 100,
      uri: 'https://example.com/agent.json',
      uriHash: 'hash',
      name: 'Agent Hundred',
      description: 'Test metadata',
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      image: null,
      active: true,
      x402Support: true,
      erc8004Support: null,
      services: ['web', 'twitter', 'email', 'mcp'],
      registrations: [],
      supportedTrusts: [],
      serviceEntries: [
        { name: 'web', endpoint: 'https://example.com/app' },
        { name: 'twitter', endpoint: '@agent100' },
        { name: 'email', endpoint: 'CONTACT@example.com' },
        { name: 'mcp', endpoint: 'https://example.com/mcp' },
        { name: 'web', endpoint: 'javascript:alert(1)' },
      ],
      contactEmails: ['contact@example.com'],
      contactTwitter: ['https://twitter.com/agent100'],
      rawMetadata: {
        external_url: 'https://example.com/app',
      },
      resolveStatus: 'resolved',
      resolveError: null,
      resolvedAt: 1700000000000,
      eventTimestamp: 1700000000000,
      eventTxHash: '0xreg',
      eventBlockNumber: 1,
    })

    const res = await invokeRoute(router, 'get', '/:agentId', { params: { agentId: '100' } })
    const body = res.body as Record<string, unknown>
    const resolvedMetadata = body.resolvedMetadata as Record<string, unknown>
    const links = resolvedMetadata.links as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect((body.agent as Record<string, unknown>).agentId).toBe('100')
    expect((body.feedback as Record<string, unknown>).items).toBeDefined()
    expect(Array.isArray(links)).toBe(true)
    expect(links).toEqual([
      {
        kind: 'web',
        label: 'example.com/app',
        href: 'https://example.com/app',
        endpoint: 'https://example.com/app',
        serviceName: 'web',
      },
      {
        kind: 'twitter',
        label: '@agent100',
        href: 'https://x.com/agent100',
        endpoint: '@agent100',
        serviceName: 'twitter',
      },
      {
        kind: 'email',
        label: 'contact@example.com',
        href: 'mailto:contact@example.com',
        endpoint: 'contact@example.com',
        serviceName: 'email',
      },
    ])
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
