import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.mock('../src/utils/logger', () => ({
  log: vi.fn(),
}))

// Create a mock MongoDBClient factory
function createMockDbClient() {
  return {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    upsertBulk: vi.fn().mockResolvedValue({ ok: 1 }),
    delete: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
    distinct: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue({ insertedId: 'id' }),
  }
}

const mockClient = createMockDbClient()

// Mock MongoPoolManager so all repos get our mock client
vi.mock('../src/utils/mongoPoolManager', () => ({
  MongoPoolManager: {
    getInstance: vi.fn().mockReturnValue({
      createClient: vi.fn().mockResolvedValue(mockClient),
    }),
  },
}))

describe('chain-state.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getChainSyncState calls findOne with chainId filter', async () => {
    const { getChainSyncState } = await import('../src/repositories/chain-state.repository')
    mockClient.findOne.mockResolvedValueOnce({ chainId: 1, lastSyncedBlock: 100 })

    const result = await getChainSyncState(1)
    expect(mockClient.findOne).toHaveBeenCalledWith({ chainId: 1 })
    expect(result).toEqual({ chainId: 1, lastSyncedBlock: 100 })
  })

  it('upsertChainSyncState calls upsert with chain filter', async () => {
    const { upsertChainSyncState } = await import('../src/repositories/chain-state.repository')
    const state = {
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 200,
      lastSyncedBlockHash: '0xabc',
      updatedAt: Date.now(),
    }

    await upsertChainSyncState(state)
    expect(mockClient.upsert).toHaveBeenCalledWith(state, { chainId: 1 })
  })
})

describe('event.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertEventFact calls upsert with unique-index filter', async () => {
    const { upsertEventFact } = await import('../src/repositories/event.repository')
    const fact = { id: '1:0xabc:0', chainId: 1, txHash: '0xabc', logIndex: 0 } as any

    await upsertEventFact(fact)
    expect(mockClient.upsert).toHaveBeenCalledWith(fact, { chainId: 1, txHash: '0xabc', logIndex: 0 })
  })

  it('upsertEventBatch skips empty array', async () => {
    const { upsertEventBatch } = await import('../src/repositories/event.repository')

    await upsertEventBatch([])
    expect(mockClient.upsertBulk).not.toHaveBeenCalled()
  })

  it('upsertEventBatch calls upsertBulk with mapped filters', async () => {
    const { upsertEventBatch } = await import('../src/repositories/event.repository')
    const facts = [
      { id: '1:0xabc:0', chainId: 1, txHash: '0xabc', logIndex: 0 } as any,
      { id: '1:0xabc:1', chainId: 1, txHash: '0xabc', logIndex: 1 } as any,
    ]

    await upsertEventBatch(facts)
    expect(mockClient.upsertBulk).toHaveBeenCalledOnce()
    const items = mockClient.upsertBulk.mock.calls[0][0]
    expect(items).toHaveLength(2)
    expect(items[0].filter).toEqual({ chainId: 1, txHash: '0xabc', logIndex: 0 })
  })

  it('deleteEventFactsByBlock calls delete with chain+block filter', async () => {
    const { deleteEventFactsByBlock } = await import('../src/repositories/event.repository')

    await deleteEventFactsByBlock(1, 500)
    expect(mockClient.delete).toHaveBeenCalledWith({ chainId: 1, blockNumber: 500 })
  })
})

describe('transaction.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertTransactionFact calls upsert with unique-index filter', async () => {
    const { upsertTransactionFact } = await import('../src/repositories/transaction.repository')
    const fact = { id: '1:0xtx', chainId: 1, txHash: '0xtx' } as any

    await upsertTransactionFact(fact)
    expect(mockClient.upsert).toHaveBeenCalledWith(fact, { chainId: 1, txHash: '0xtx' })
  })

  it('upsertCallFact calls upsert with unique-index filter', async () => {
    const { upsertCallFact } = await import('../src/repositories/transaction.repository')
    const fact = { id: '1:0xcall', chainId: 1, txHash: '0xcall' } as any

    await upsertCallFact(fact)
    expect(mockClient.upsert).toHaveBeenCalledWith(fact, { chainId: 1, txHash: '0xcall' })
  })

  it('upsertTransactionBatch handles tx and call facts', async () => {
    const { upsertTransactionBatch } = await import('../src/repositories/transaction.repository')
    const txFacts = [{ id: '1:0xtx1', chainId: 1, txHash: '0xtx1' } as any]
    const callFacts = [{ id: '1:0xcall1', chainId: 1, txHash: '0xcall1' } as any]

    await upsertTransactionBatch(txFacts, callFacts)
    expect(mockClient.upsertBulk).toHaveBeenCalledTimes(2)
  })

  it('upsertTransactionBatch skips empty arrays', async () => {
    const { upsertTransactionBatch } = await import('../src/repositories/transaction.repository')

    await upsertTransactionBatch([], [])
    expect(mockClient.upsertBulk).not.toHaveBeenCalled()
  })

  it('deleteTransactionFactsByBlock deletes tx facts and related call facts', async () => {
    const { deleteTransactionFactsByBlock } = await import('../src/repositories/transaction.repository')
    mockClient.find.mockResolvedValueOnce([
      { txHash: '0xhash1' },
      { txHash: '0xhash2' },
    ])

    await deleteTransactionFactsByBlock(1, 100)
    // Delete tx facts
    expect(mockClient.delete).toHaveBeenCalledWith({ chainId: 1, blockNumber: 100 })
    // Find tx hashes to delete associated call facts
    expect(mockClient.find).toHaveBeenCalledWith({ chainId: 1, blockNumber: 100 })
    // Delete call facts for each hash
    expect(mockClient.delete).toHaveBeenCalledWith({ chainId: 1, txHash: '0xhash1' })
    expect(mockClient.delete).toHaveBeenCalledWith({ chainId: 1, txHash: '0xhash2' })
  })

  it('deleteTransactionFactsByBlock skips call fact deletion when no txs found', async () => {
    const { deleteTransactionFactsByBlock } = await import('../src/repositories/transaction.repository')
    mockClient.find.mockResolvedValueOnce([])

    await deleteTransactionFactsByBlock(1, 100)
    // Only the initial delete for tx facts
    expect(mockClient.delete).toHaveBeenCalledTimes(1)
  })
})

describe('graph.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertReviewEdge calls upsert with feedbackId filter', async () => {
    const { upsertReviewEdge } = await import('../src/repositories/graph.repository')
    const edge = { feedbackId: 'fb1' } as any

    await upsertReviewEdge(edge)
    expect(mockClient.upsert).toHaveBeenCalledWith(edge, { feedbackId: 'fb1' })
  })

  it('upsertRegistrantEdge calls upsert with chainId+agentId filter', async () => {
    const { upsertRegistrantEdge } = await import('../src/repositories/graph.repository')
    const edge = { chainId: 1, sourceAgentId: 100 } as any

    await upsertRegistrantEdge(edge)
    expect(mockClient.upsert).toHaveBeenCalledWith(edge, { chainId: 1, sourceAgentId: 100 })
  })

  it('upsertAgentReviewEdge calls upsert with feedbackId filter', async () => {
    const { upsertAgentReviewEdge } = await import('../src/repositories/graph.repository')
    const edge = { feedbackId: 'fb2' } as any

    await upsertAgentReviewEdge(edge)
    expect(mockClient.upsert).toHaveBeenCalledWith(edge, { feedbackId: 'fb2' })
  })

  it('upsertResponseEdge calls upsert with composite filter', async () => {
    const { upsertResponseEdge } = await import('../src/repositories/graph.repository')
    const edge = { chainId: 1, feedbackId: 'fb1', txHash: '0xabc', logIndex: 5 } as any

    await upsertResponseEdge(edge)
    expect(mockClient.upsert).toHaveBeenCalledWith(edge, {
      chainId: 1,
      feedbackId: 'fb1',
      txHash: '0xabc',
      logIndex: 5,
    })
  })

  it('upsertGraphEdgeBatch processes all edge types', async () => {
    const { upsertGraphEdgeBatch } = await import('../src/repositories/graph.repository')
    const reviews = [{ feedbackId: 'fb1' } as any]
    const registrants = [{ chainId: 1, sourceAgentId: 1 } as any]
    const agentReviews = [{ feedbackId: 'fb2' } as any]
    const responses = [{ chainId: 1, feedbackId: 'fb1', txHash: '0x', logIndex: 0 } as any]

    await upsertGraphEdgeBatch(reviews, registrants, agentReviews, responses)
    expect(mockClient.upsertBulk).toHaveBeenCalledTimes(4)
  })

  it('upsertGraphEdgeBatch skips empty arrays', async () => {
    const { upsertGraphEdgeBatch } = await import('../src/repositories/graph.repository')

    await upsertGraphEdgeBatch([], [], [], [])
    expect(mockClient.upsertBulk).not.toHaveBeenCalled()
  })

  it('deleteGraphEdgesByBlock is a no-op (handled at service level)', async () => {
    const { deleteGraphEdgesByBlock } = await import('../src/repositories/graph.repository')

    // Should not throw
    await deleteGraphEdgesByBlock(1, 100)
  })
})

describe('agent-metadata.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertAgentMetadata calls upsert with id filter', async () => {
    const { upsertAgentMetadata } = await import('../src/repositories/agent-metadata.repository')
    const row = { id: '1:7', chainId: 1, agentId: 7 } as any

    await upsertAgentMetadata(row)
    expect(mockClient.upsert).toHaveBeenCalledWith(row, { id: '1:7' })
  })

  it('getAgentMetadataByAgent calls findOne with chainId + agentId', async () => {
    const { getAgentMetadataByAgent } = await import('../src/repositories/agent-metadata.repository')
    mockClient.findOne.mockResolvedValueOnce({ id: '1:7', chainId: 1, agentId: 7 })

    const result = await getAgentMetadataByAgent(1, 7)
    expect(mockClient.findOne).toHaveBeenCalledWith({ chainId: 1, agentId: 7 })
    expect(result).toEqual({ id: '1:7', chainId: 1, agentId: 7 })
  })

  it('getAgentMetadataBatch uses $in for ids', async () => {
    const { getAgentMetadataBatch } = await import('../src/repositories/agent-metadata.repository')
    mockClient.find.mockResolvedValueOnce([{ id: '1:7', chainId: 1, agentId: 7 }])

    const result = await getAgentMetadataBatch(1, [7, 8, 7])
    expect(mockClient.find).toHaveBeenCalledWith({ chainId: 1, agentId: { $in: [7, 8] } })
    expect(result).toEqual([{ id: '1:7', chainId: 1, agentId: 7 }])
  })
})

describe('agent-metadata-raw.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertAgentMetadataRawSnapshot calls upsert with id filter', async () => {
    const { upsertAgentMetadataRawSnapshot } = await import('../src/repositories/agent-metadata-raw.repository')
    const row = { id: '1:7:abc', chainId: 1, agentId: 7, uriHash: 'abc' } as any

    await upsertAgentMetadataRawSnapshot(row)
    expect(mockClient.upsert).toHaveBeenCalledWith(row, { id: '1:7:abc' })
  })
})
