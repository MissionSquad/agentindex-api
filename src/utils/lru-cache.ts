/**
 * Simple Map-based LRU cache.
 * Uses Map insertion order: oldest entries are evicted when capacity is exceeded.
 */
export class LruCache<K, V> {
  private readonly maxSize: number
  private readonly cache: Map<K, V>

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new Error('LRU cache maxSize must be >= 1')
    }
    this.maxSize = maxSize
    this.cache = new Map<K, V>()
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value === undefined) {
      return undefined
    }
    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry)
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.delete(oldest)
      }
    }
    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  get size(): number {
    return this.cache.size
  }
}
