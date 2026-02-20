import { describe, expect, it } from 'vitest'
import { LruCache } from '../src/utils/lru-cache'

describe('LruCache', () => {
  it('throws on maxSize < 1', () => {
    expect(() => new LruCache(0)).toThrow('LRU cache maxSize must be >= 1')
    expect(() => new LruCache(-1)).toThrow('LRU cache maxSize must be >= 1')
  })

  it('stores and retrieves a value', () => {
    const cache = new LruCache<string, number>(5)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    expect(cache.size).toBe(1)
  })

  it('returns undefined for missing key', () => {
    const cache = new LruCache<string, number>(5)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('overwrites existing key', () => {
    const cache = new LruCache<string, number>(5)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.get('a')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('evicts oldest entry when capacity exceeded', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    // Full — adding d should evict a
    cache.set('d', 4)
    expect(cache.has('a')).toBe(false)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
    expect(cache.size).toBe(3)
  })

  it('promotes accessed entry to most-recently-used', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    // Access a — promotes it, so b is now oldest
    cache.get('a')
    cache.set('d', 4)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  it('works with maxSize = 1', () => {
    const cache = new LruCache<string, number>(1)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    cache.set('b', 2)
    expect(cache.has('a')).toBe(false)
    expect(cache.get('b')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('has returns correct boolean', () => {
    const cache = new LruCache<string, number>(5)
    expect(cache.has('x')).toBe(false)
    cache.set('x', 10)
    expect(cache.has('x')).toBe(true)
  })
})
