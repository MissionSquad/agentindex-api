import { describe, it, expect } from 'vitest'
import { parseRegistrationJson } from '../src/services/offchain-fetch.service'

describe('parseRegistrationJson', () => {
  it('parses valid JSON buffer', () => {
    const json = { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Test Agent' }
    const buf = Buffer.from(JSON.stringify(json), 'utf-8')
    const result = parseRegistrationJson(buf)

    expect(result).not.toBeNull()
    expect(result!['name']).toBe('Test Agent')
    expect(result!['type']).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1')
  })

  it('returns null for invalid JSON', () => {
    const buf = Buffer.from('not json', 'utf-8')
    const result = parseRegistrationJson(buf)
    expect(result).toBeNull()
  })

  it('returns null for empty buffer', () => {
    const buf = Buffer.from('', 'utf-8')
    const result = parseRegistrationJson(buf)
    expect(result).toBeNull()
  })

  it('parses a base64-decoded data URI payload', () => {
    // This is the actual pattern from observed register transactions
    const registrationJson = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Avi Security Auditor',
      description: 'Autonomous security auditor',
      active: true,
      x402Support: false,
      services: [{ name: 'security-audit', endpoint: 'https://example.com/audit' }],
    }
    const base64 = Buffer.from(JSON.stringify(registrationJson)).toString('base64')
    const dataUri = `data:application/json;base64,${base64}`

    // Simulate extracting the base64 portion
    const commaIndex = dataUri.indexOf(',')
    const base64Data = dataUri.slice(commaIndex + 1)
    const decoded = Buffer.from(base64Data, 'base64')
    const result = parseRegistrationJson(decoded)

    expect(result).not.toBeNull()
    expect(result!['name']).toBe('Avi Security Auditor')
    expect(result!['x402Support']).toBe(false)
    expect((result!['services'] as Array<{ name: string }>)[0].name).toBe('security-audit')
  })
})
