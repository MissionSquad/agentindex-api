import { describe, it, expect, vi } from 'vitest'
import { fetchOffchainContent, parseRegistrationJson } from '../src/services/offchain-fetch.service'
import { gzipSync } from 'node:zlib'

// Mock logger to suppress output during tests
vi.mock('../src/utils/logger', () => ({
  log: vi.fn(),
}))

describe('fetchOffchainContent', () => {
  it('returns null for empty URI', async () => {
    const result = await fetchOffchainContent('')
    expect(result).toBeNull()
  })

  it('accepts inline JSON payloads in the URI field', async () => {
    const uri = '{"name":"saltyboi_cash","type":"user"}'
    const result = await fetchOffchainContent(uri)
    expect(result).not.toBeNull()
    expect(result!.toString('utf-8')).toBe(uri)
    expect(parseRegistrationJson(result!)).toEqual({
      name: 'saltyboi_cash',
      type: 'user',
    })
  })

  it('decodes a data: URI with base64 content', async () => {
    const payload = JSON.stringify({ name: 'TestAgent' })
    const base64 = Buffer.from(payload).toString('base64')
    const uri = `data:application/json;base64,${base64}`

    const result = await fetchOffchainContent(uri)
    expect(result).not.toBeNull()
    expect(result!.toString('utf-8')).toBe(payload)
  })

  it('decodes a gzip+base64 data: URI', async () => {
    const payload = JSON.stringify({ name: 'GzipAgent' })
    const compressed = gzipSync(Buffer.from(payload, 'utf-8')).toString('base64')
    const uri = `data:application/json;enc=gzip;base64,${compressed}`

    const result = await fetchOffchainContent(uri)
    expect(result).not.toBeNull()
    expect(result!.toString('utf-8')).toBe(payload)
  })

  it('returns null for data: URI without comma', async () => {
    const result = await fetchOffchainContent('data:application/json;base64')
    expect(result).toBeNull()
  })

  it('returns null for unsupported URI scheme', async () => {
    const result = await fetchOffchainContent('ftp://example.com/file')
    expect(result).toBeNull()
  })

  it('handles ipfs:// URIs using configured gateway candidates', async () => {
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(Buffer.from('ipfs content'), { status: 200 }))

    const result = await fetchOffchainContent('ipfs://QmTest123')
    expect(result).not.toBeNull()
    expect(result!.toString('utf-8')).toBe('ipfs content')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/QmTest123'),
      expect.objectContaining({ headers: { 'User-Agent': 'ERC8004-Scanner/1.0' } }),
    )
    mockFetch.mockRestore()
  })

  it('falls back to the next IPFS gateway when the first fails', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(Buffer.from('ipfs via fallback'), { status: 200 }))

    const result = await fetchOffchainContent('ipfs://QmFallback')
    expect(result).not.toBeNull()
    expect(result!.toString('utf-8')).toBe('ipfs via fallback')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).toContain('ipfs.io')
    expect(mockFetch.mock.calls[1][0]).toContain('cloudflare-ipfs.com')
    mockFetch.mockRestore()
  })

  it('handles https:// URIs', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from('https content'), { status: 200 }),
    )

    const result = await fetchOffchainContent('https://example.com/agent.json')
    expect(result).not.toBeNull()
    expect(result!.toString('utf-8')).toBe('https content')
    mockFetch.mockRestore()
  })

  it('returns null when HTTP response is not ok', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )

    const result = await fetchOffchainContent('https://example.com/missing')
    expect(result).toBeNull()
    mockFetch.mockRestore()
  })

  it('returns null when fetch throws', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'))

    const result = await fetchOffchainContent('https://example.com/timeout')
    expect(result).toBeNull()
    mockFetch.mockRestore()
  })
})

describe('parseRegistrationJson', () => {
  it('parses valid JSON buffer', () => {
    const json = { type: 'test', name: 'Agent' }
    const buf = Buffer.from(JSON.stringify(json), 'utf-8')
    const result = parseRegistrationJson(buf)
    expect(result).toEqual(json)
  })

  it('returns null for invalid JSON', () => {
    const result = parseRegistrationJson(Buffer.from('not json'))
    expect(result).toBeNull()
  })
})
