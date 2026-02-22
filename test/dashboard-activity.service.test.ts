import { describe, expect, it } from 'vitest'
import {
  buildEventSummary,
  toDashboardActivityItem,
  toTimestampMs,
} from '../src/services/dashboard-activity.service'
import type { EventFact } from '../src/types/mongo'

describe('dashboard-activity.service', () => {
  it('normalizes seconds timestamps to milliseconds', () => {
    expect(toTimestampMs(1_700_000_000)).toBe(1_700_000_000_000)
    expect(toTimestampMs('1700000000')).toBe(1_700_000_000_000)
    expect(toTimestampMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })

  it('builds canonical event summaries', () => {
    expect(buildEventSummary('NewFeedback', { clientAddress: '0xabc' })).toBe('Feedback from 0xabc')
    expect(buildEventSummary('Transfer', { from: '0x1', to: '0x2' })).toBe('0x1 -> 0x2')
    expect(buildEventSummary('UnknownEvent', {})).toBe('')
  })

  it('maps EventFact to DashboardActivityItem with chainId and logIndex', () => {
    const eventFact: EventFact = {
      id: '1:0xabc:7',
      chainId: 1,
      registryAddress: '0x0000000000000000000000000000000000000001',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      blockNumber: 123,
      timestamp: 1_700_000_000,
      logIndex: 7,
      topic0: '0xtopic',
      topics: [],
      data: '0x',
      eventName: 'Registered',
      eventSignature: 'Registered(uint256,address,string)',
      eventArgs: {
        tokenId: 42,
        owner: '0x0000000000000000000000000000000000000002',
      },
    }

    const mapped = toDashboardActivityItem(eventFact)

    expect(mapped.chainId).toBe(1)
    expect(mapped.logIndex).toBe(7)
    expect(mapped.agentId).toBe('42')
    expect(mapped.agentName).toBeNull()
    expect(mapped.agentImageUrl).toBeNull()
    expect(mapped.timestamp).toBe(1_700_000_000_000)
    expect(mapped.summary).toBe('Registered by 0x0000000000000000000000000000000000000002')
  })
})
