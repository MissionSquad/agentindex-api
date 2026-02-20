import { describe, it, expect, vi } from 'vitest'
import { retryWithBackoff, sleep } from '../src/utils/retry'

// Mock logger to suppress output during tests
vi.mock('../src/utils/logger', () => ({
  log: vi.fn(),
}))

describe('sleep', () => {
  it('resolves after the given duration', async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })
})

describe('retryWithBackoff', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await retryWithBackoff(fn, 3, 10, 100)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries on failure then returns on success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('recovered')

    const result = await retryWithBackoff(fn, 5, 10, 50)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after max retries exceeded', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))

    await expect(retryWithBackoff(fn, 2, 10, 50)).rejects.toThrow('always fails')
    // 1 initial + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('caps delay at maxDelayMs', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok')

    // baseDelay=50, maxDelay=60 → delays are 50, 60 (capped), 60 (capped)
    const start = Date.now()
    await retryWithBackoff(fn, 5, 50, 60)
    const elapsed = Date.now() - start
    // Should have waited ~170ms (50 + 60 + 60), give some leeway
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(fn).toHaveBeenCalledTimes(4)
  })
})
