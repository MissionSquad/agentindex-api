import { describe, it, expect } from 'vitest'
import { buildSearchX402Endpoints } from '../src/config/x402-search'

describe('x402 search endpoint config', () => {
  it('builds fixed-price endpoint definitions for search and agent directory routes', () => {
    const endpoints = buildSearchX402Endpoints('http://127.0.0.1:3100')

    expect(endpoints).toHaveLength(3)
    expect(endpoints.map((endpoint) => endpoint.publicPath)).toEqual([
      '/v1/search',
      '/v1/search/agents',
      '/v1/agents',
    ])

    for (const endpoint of endpoints) {
      expect(endpoint.kind).toBe('http')
      expect(endpoint.method).toBe('GET')
      expect(endpoint.price).toBe('0.02')
    }
  })

  it('normalizes trailing slashes in upstream origin', () => {
    const endpoints = buildSearchX402Endpoints('http://127.0.0.1:3100///')

    expect(endpoints[0]?.upstreamUrl).toBe('http://127.0.0.1:3100/v1/search')
    expect(endpoints[1]?.upstreamUrl).toBe('http://127.0.0.1:3100/v1/search/agents')
    expect(endpoints[2]?.upstreamUrl).toBe('http://127.0.0.1:3100/v1/agents')
  })
})
