import { describe, it, expect } from 'vitest'
import { TRACKED_ADDRESSES, TRACKED_SELECTORS, ERC8004_CONTRACTS } from '../src/config/erc8004'

describe('Candidate Filter', () => {
  it('includes tx when `to` is the Identity Registry', () => {
    const toAddr = ERC8004_CONTRACTS.IDENTITY_REGISTRY
    expect(TRACKED_ADDRESSES.has(toAddr)).toBe(true)
  })

  it('includes tx when `to` is the Reputation Registry', () => {
    const toAddr = ERC8004_CONTRACTS.REPUTATION_REGISTRY
    expect(TRACKED_ADDRESSES.has(toAddr)).toBe(true)
  })

  it('excludes tx when `to` is an unrelated contract', () => {
    const toAddr = '0x1234567890abcdef1234567890abcdef12345678'
    expect(TRACKED_ADDRESSES.has(toAddr)).toBe(false)
  })

  it('includes tx with register(string) selector', () => {
    expect(TRACKED_SELECTORS.has('0xf2c298be')).toBe(true)
  })

  it('includes tx with giveFeedback selector', () => {
    expect(TRACKED_SELECTORS.has('0x3c036a7e')).toBe(true)
  })

  it('includes tx with appendResponse selector', () => {
    expect(TRACKED_SELECTORS.has('0xc2349ab2')).toBe(true)
  })

  it('includes tx with revokeFeedback selector', () => {
    expect(TRACKED_SELECTORS.has('0x4ab3ca99')).toBe(true)
  })

  it('includes tx with transferFrom selector', () => {
    expect(TRACKED_SELECTORS.has('0x23b872dd')).toBe(true)
  })

  it('includes tx with safeTransferFrom(3-arg) selector', () => {
    expect(TRACKED_SELECTORS.has('0x42842e0e')).toBe(true)
  })

  it('includes tx with safeTransferFrom(4-arg) selector', () => {
    expect(TRACKED_SELECTORS.has('0xb88d4fde')).toBe(true)
  })

  it('includes tx with setApprovalForAll selector', () => {
    expect(TRACKED_SELECTORS.has('0xa22cb465')).toBe(true)
  })

  it('includes tx with setAgentURI selector', () => {
    expect(TRACKED_SELECTORS.has('0x0af28bd3')).toBe(true)
  })

  it('includes tx with setMetadata selector', () => {
    expect(TRACKED_SELECTORS.has('0x466648da')).toBe(true)
  })

  it('excludes tx with unknown selector', () => {
    expect(TRACKED_SELECTORS.has('0xdeadbeef')).toBe(false)
  })

  it('correctly filters a candidate from mock block data', () => {
    const mockTransactions = [
      { hash: '0xaaa', to: ERC8004_CONTRACTS.IDENTITY_REGISTRY, input: '0xf2c298be000000' },
      { hash: '0xbbb', to: '0x1111111111111111111111111111111111111111', input: '0xf2c298be000000' },
      { hash: '0xccc', to: ERC8004_CONTRACTS.REPUTATION_REGISTRY, input: '0x3c036a7e000000' },
      { hash: '0xddd', to: ERC8004_CONTRACTS.IDENTITY_REGISTRY, input: '0xdeadbeef000000' },
      { hash: '0xeee', to: null, input: '0xf2c298be000000' },
    ]

    const candidates = mockTransactions.filter((tx) => {
      if (!tx.to) return false
      const toAddr = tx.to.toLowerCase()
      if (!TRACKED_ADDRESSES.has(toAddr)) return false
      const selector = tx.input.slice(0, 10)
      return TRACKED_SELECTORS.has(selector)
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0].hash).toBe('0xaaa')
    expect(candidates[1].hash).toBe('0xccc')
  })
})
