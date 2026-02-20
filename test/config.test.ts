import { describe, it, expect } from 'vitest'
import {
  ERC8004_CONTRACTS,
  TRACKED_ADDRESSES,
  TRACKED_SELECTORS,
  EVENT_TOPIC0,
  TOPIC0_TO_EVENT_NAME,
  ARG_NORMALIZATION,
} from '../src/config/erc8004'

describe('ERC-8004 Configuration', () => {
  it('contract addresses are lowercase', () => {
    expect(ERC8004_CONTRACTS.IDENTITY_REGISTRY).toBe(ERC8004_CONTRACTS.IDENTITY_REGISTRY.toLowerCase())
    expect(ERC8004_CONTRACTS.REPUTATION_REGISTRY).toBe(ERC8004_CONTRACTS.REPUTATION_REGISTRY.toLowerCase())
  })

  it('tracked addresses contains both registries', () => {
    expect(TRACKED_ADDRESSES.size).toBe(2)
    expect(TRACKED_ADDRESSES.has(ERC8004_CONTRACTS.IDENTITY_REGISTRY)).toBe(true)
    expect(TRACKED_ADDRESSES.has(ERC8004_CONTRACTS.REPUTATION_REGISTRY)).toBe(true)
  })

  it('has 14 tracked selectors for Phase 1', () => {
    expect(TRACKED_SELECTORS.size).toBe(14)
  })

  it('event topic0 map covers all Phase 1 events', () => {
    const expectedEvents = [
      'Transfer',
      'Registered',
      'URIUpdated',
      'MetadataSet',
      'MetadataUpdate',
      'ApprovalForAll',
      'NewFeedback',
      'FeedbackRevoked',
      'ResponseAppended',
    ]

    for (const evt of expectedEvents) {
      expect(EVENT_TOPIC0).toHaveProperty(evt)
      expect(EVENT_TOPIC0[evt as keyof typeof EVENT_TOPIC0]).toMatch(/^0x[0-9a-f]{64}$/)
    }
  })

  it('topic0 reverse lookup works for all events', () => {
    for (const [name, topic] of Object.entries(EVENT_TOPIC0)) {
      expect(TOPIC0_TO_EVENT_NAME[topic]).toBe(name)
    }
  })

  it('arg normalization for transferFrom maps _from/_to/_value to from/to/tokenId', () => {
    const mapping = ARG_NORMALIZATION['transferFrom(address,address,uint256)']
    expect(mapping).toBeDefined()
    expect(mapping._from).toBe('from')
    expect(mapping._to).toBe('to')
    expect(mapping._value).toBe('tokenId')
  })

  it('arg normalization for register(string) maps agentURI to uri', () => {
    const mapping = ARG_NORMALIZATION['register(string)']
    expect(mapping).toBeDefined()
    expect(mapping.agentURI).toBe('uri')
  })

  it('arg normalization for setAgentURI maps newURI to uri', () => {
    const mapping = ARG_NORMALIZATION['setAgentURI(uint256,string)']
    expect(mapping).toBeDefined()
    expect(mapping.newURI).toBe('uri')
  })
})
