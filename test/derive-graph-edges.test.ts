import { describe, it, expect, vi } from 'vitest'
import type { EventFact } from '../src/types/mongo'

// Mock the repository dependency
vi.mock('../src/repositories/graph.repository', () => ({
  getRegistrantEdgeClient: vi.fn().mockResolvedValue({
    find: vi.fn().mockResolvedValue([
      { sourceAgentId: 100, ownerAddress: '0xclient' },
    ]),
  }),
}))

import { deriveGraphEdges } from '../src/services/mapper.service'

const CHAIN_ID = 1

function makeEventFact(overrides: Partial<EventFact>): EventFact {
  return {
    id: '1:0xabc:0',
    chainId: CHAIN_ID,
    registryAddress: '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',
    txHash: '0xabc',
    blockNumber: 100,
    timestamp: 1700000000,
    logIndex: 0,
    topic0: '0x',
    topics: [],
    data: '0x',
    eventName: '',
    eventSignature: '',
    eventArgs: {},
    ...overrides,
  }
}

describe('deriveGraphEdges', () => {
  it('derives registrant edge from Registered event', async () => {
    const events: EventFact[] = [
      makeEventFact({
        eventName: 'Registered',
        eventArgs: {
          agentId: 25475,
          owner: '0xFe90787F976f145059a8FCE71d99a006a209FC48',
        },
      }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.registrants).toHaveLength(1)
    expect(result.registrants[0].ownerAddress).toBe('0xfe90787f976f145059a8fce71d99a006a209fc48')
    expect(result.registrants[0].sourceAgentId).toBe(25475)
    expect(result.registrants[0].chainId).toBe(CHAIN_ID)
    expect(result.reviews).toHaveLength(0)
    expect(result.responses).toHaveLength(0)
  })

  it('derives review edge and agent-review edge from NewFeedback event', async () => {
    const events: EventFact[] = [
      makeEventFact({
        eventName: 'NewFeedback',
        eventArgs: {
          agentId: 200,
          clientAddress: '0xClient',
          feedbackIndex: 1,
          value: 850,
          valueDecimals: 2,
          tag1: 'quality',
          tag2: 'speed',
        },
      }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0].targetAgentId).toBe(200)
    expect(result.reviews[0].clientAddress).toBe('0xclient')
    expect(result.reviews[0].score).toBe(8.5) // 850 / 10^2
    expect(result.reviews[0].tag1).toBe('quality')
    expect(result.reviews[0].tag2).toBe('speed')
    expect(result.reviews[0].feedbackId).toBe('1:200:0xclient:1')

    // Agent-to-agent edge (mock returns sourceAgentId=100 for clientAddress)
    expect(result.agentReviews).toHaveLength(1)
    expect(result.agentReviews[0].sourceAgentId).toBe(100)
    expect(result.agentReviews[0].targetAgentId).toBe(200)
    expect(result.agentReviews[0].viaAddress).toBe('0xclient')
  })

  it('derives response edge from ResponseAppended event', async () => {
    const events: EventFact[] = [
      makeEventFact({
        eventName: 'ResponseAppended',
        logIndex: 310,
        eventArgs: {
          agentId: 200,
          clientAddress: '0xClient123',
          feedbackIndex: 5,
          responder: '0xResponder456',
        },
      }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.responses).toHaveLength(1)
    expect(result.responses[0].feedbackId).toBe('1:200:0xclient123:5')
    expect(result.responses[0].responder).toBe('0xresponder456')
    expect(result.responses[0].targetAgentId).toBe(200)
    expect(result.responses[0].logIndex).toBe(310)
  })

  it('returns empty arrays for unrecognized events', async () => {
    const events: EventFact[] = [
      makeEventFact({ eventName: 'Transfer' }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.registrants).toHaveLength(0)
    expect(result.reviews).toHaveLength(0)
    expect(result.agentReviews).toHaveLength(0)
    expect(result.responses).toHaveLength(0)
  })

  it('handles multiple events in a single call', async () => {
    const events: EventFact[] = [
      makeEventFact({
        eventName: 'Registered',
        eventArgs: { agentId: 1, owner: '0xOwner1' },
      }),
      makeEventFact({
        eventName: 'ResponseAppended',
        logIndex: 2,
        eventArgs: {
          agentId: 1,
          clientAddress: '0xClient1',
          feedbackIndex: 0,
          responder: '0xResp1',
        },
      }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.registrants).toHaveLength(1)
    expect(result.responses).toHaveLength(1)
  })

  it('handles bigint and string eventArgs via toNumber/toString helpers', async () => {
    const events: EventFact[] = [
      makeEventFact({
        eventName: 'NewFeedback',
        eventArgs: {
          agentId: BigInt(300),
          clientAddress: '0xBigIntClient',
          feedbackIndex: '7',
          value: '1000',
          valueDecimals: '3',
          tag1: 'reliability',
          tag2: '',
        },
      }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0].targetAgentId).toBe(300)
    expect(result.reviews[0].score).toBe(1) // 1000 / 10^3
    expect(result.reviews[0].tag1).toBe('reliability')
  })

  it('handles null/undefined eventArgs gracefully', async () => {
    const events: EventFact[] = [
      makeEventFact({
        eventName: 'Registered',
        eventArgs: {
          agentId: null,
          owner: null,
        },
      }),
    ]

    const result = await deriveGraphEdges(CHAIN_ID, events, '0xabc')

    expect(result.registrants).toHaveLength(1)
    expect(result.registrants[0].sourceAgentId).toBe(0)
    expect(result.registrants[0].ownerAddress).toBe('')
  })
})
