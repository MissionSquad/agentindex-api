import { describe, it, expect } from 'vitest'
import { parsePagination, setSSEHeaders } from '../src/controllers/helpers'

describe('parsePagination', () => {
  it('returns defaults when no query params provided', () => {
    const result = parsePagination({})
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
    expect(result.skip).toBe(0)
    expect(result.sort).toEqual({ blockNumber: -1 })
    expect(result.chainId).toBeUndefined()
  })

  it('parses valid page and limit', () => {
    const result = parsePagination({ page: '3', limit: '50' })
    expect(result.page).toBe(3)
    expect(result.limit).toBe(50)
    expect(result.skip).toBe(100)
  })

  it('clamps limit to max 100', () => {
    const result = parsePagination({ limit: '500' })
    expect(result.limit).toBe(100)
  })

  it('falls back to default limit when 0 is provided', () => {
    const result = parsePagination({ limit: '0' })
    // parseInt('0') is 0, which is falsy, so || 20 fallback applies
    expect(result.limit).toBe(20)
  })

  it('clamps limit to min 1', () => {
    const result = parsePagination({ limit: '-5' })
    expect(result.limit).toBe(1)
  })

  it('clamps page to min 1', () => {
    const result = parsePagination({ page: '-5' })
    expect(result.page).toBe(1)
  })

  it('parses sort and order', () => {
    const result = parsePagination({ sort: 'timestamp', order: 'asc' })
    expect(result.sort).toEqual({ timestamp: 1 })
  })

  it('defaults to desc order', () => {
    const result = parsePagination({ sort: 'timestamp' })
    expect(result.sort).toEqual({ timestamp: -1 })
  })

  it('parses chainId', () => {
    const result = parsePagination({ chainId: '137' })
    expect(result.chainId).toBe(137)
  })

  it('ignores invalid chainId', () => {
    const result = parsePagination({ chainId: 'abc' })
    expect(result.chainId).toBeUndefined()
  })
})

describe('setSSEHeaders', () => {
  it('sets all required SSE headers', () => {
    const headers: Record<string, string> = {}
    const res = { setHeader: (key: string, value: string) => { headers[key] = value } }

    setSSEHeaders(res)

    expect(headers['Content-Type']).toBe('text/event-stream')
    expect(headers['Cache-Control']).toBe('no-cache')
    expect(headers['Connection']).toBe('keep-alive')
    expect(headers['X-Accel-Buffering']).toBe('no')
  })
})
