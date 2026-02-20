import { log } from './logger'

/**
 * Retry an async operation with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retries before throwing
 * @param baseDelayMs - Base delay in milliseconds (doubled each retry)
 * @param maxDelayMs - Maximum delay cap in milliseconds
 * @returns The result of fn
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000,
): Promise<T> {
  let attempt = 0
  let delay = baseDelayMs

  while (true) {
    try {
      return await fn()
    } catch (error) {
      attempt++
      if (attempt > maxRetries) {
        log({ level: 'error', msg: `Max retries (${maxRetries}) exceeded`, error })
        throw error
      }

      log({
        level: 'warn',
        msg: `Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`,
        error,
      })

      await sleep(delay)
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
