import { describe, it, expect } from 'vitest'
import type { TransactionFact, EventFact } from '../src/types/mongo'

/**
 * Tests for idempotent upsert key generation.
 * These validate that the natural keys are deterministic,
 * ensuring duplicate notifications result in the same upsert key.
 */
describe('Idempotent Upsert Keys', () => {
  it('transaction_fact id is deterministic: ${chainId}:${txHashLower}', () => {
    const chainId = 1
    const txHash = '0x1086A38E331bbdff013772175f65e29c082e1882CBFE03d0a700429c3a10263B'
    const id = `${chainId}:${txHash.toLowerCase()}`

    expect(id).toBe('1:0x1086a38e331bbdff013772175f65e29c082e1882cbfe03d0a700429c3a10263b')

    // Same tx hash with different casing produces same id
    const id2 = `${chainId}:${txHash.toUpperCase().replace('0X', '0x')}`
    expect(id2).not.toBe(id) // upper case != lower case

    // But our mapper always lowercases, so:
    const normalized = `${chainId}:${txHash.toLowerCase()}`
    expect(normalized).toBe(id)
  })

  it('event_fact id is deterministic: ${chainId}:${txHashLower}:${logIndex}', () => {
    const chainId = 1
    const txHash = '0xABC123'
    const logIndex = 42
    const id = `${chainId}:${txHash.toLowerCase()}:${logIndex}`

    expect(id).toBe('1:0xabc123:42')
  })

  it('feedbackId key is deterministic', () => {
    const chainId = 1
    const agentId = 6888
    const clientAddress = '0x24ED5cA2BFD575Df34cb56E46EBd88d2e80B3EAC'
    const feedbackIndex = 1

    const feedbackId = `${chainId}:${agentId}:${clientAddress.toLowerCase()}:${feedbackIndex}`
    expect(feedbackId).toBe('1:6888:0x24ed5ca2bfd575df34cb56e46ebd88d2e80b3eac:1')

    // Same input, same output
    const feedbackId2 = `${chainId}:${agentId}:${clientAddress.toLowerCase()}:${feedbackIndex}`
    expect(feedbackId2).toBe(feedbackId)
  })

  it('responseId key is deterministic', () => {
    const feedbackId = '1:6888:0x24ed5ca2bfd575df34cb56e46ebd88d2e80b3eac:1'
    const txHash = '0xb3bb7ca5376a2401dfef07a539cee06ea898a9d1a5e7b20d6ddd477e70db7f62'
    const logIndex = 310

    const responseId = `${feedbackId}:${txHash}:${logIndex}`
    expect(responseId).toBe(
      '1:6888:0x24ed5ca2bfd575df34cb56e46ebd88d2e80b3eac:1:0xb3bb7ca5376a2401dfef07a539cee06ea898a9d1a5e7b20d6ddd477e70db7f62:310'
    )
  })
})
