import { gunzipSync } from 'node:zlib'
import { env } from '../env'
import { log } from '../utils/logger'
import { sleep } from '../utils/retry'

/**
 * Fetches off-chain content from agentURI, feedbackURI, or responseURI.
 * Supports raw JSON payloads, data: URIs (base64, gzip+base64), ipfs://, and https://.
 */
export async function fetchOffchainContent(uri: string): Promise<Buffer | null> {
  if (!uri) return null

  try {
    const trimmed = uri.trim()
    if (trimmed.length === 0) return null

    if (looksLikeInlineJson(trimmed)) {
      return Buffer.from(trimmed, 'utf-8')
    }

    if (trimmed.startsWith('data:')) {
      return decodeDataUri(trimmed)
    }

    if (trimmed.startsWith('ipfs://')) {
      return await fetchIpfsWithFallback(trimmed)
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return await fetchHttpContentWithRetry(
        trimmed,
        env.METADATA_HTTP_TIMEOUT_MS,
        env.METADATA_FETCH_RETRIES,
        env.METADATA_RETRY_BASE_DELAY_MS,
        env.METADATA_RETRY_MAX_DELAY_MS,
      )
    }

    log({ level: 'warn', msg: `Unsupported URI scheme: ${trimmed.slice(0, 30)}` })
    return null
  } catch (error) {
    log({ level: 'warn', msg: `Failed to fetch off-chain content: ${uri.slice(0, 80)}`, error })
    return null
  }
}

function looksLikeInlineJson(value: string): boolean {
  return value.startsWith('{') || value.startsWith('[')
}

function decodeDataUri(uri: string): Buffer | null {
  // Pattern: data:<mime>;base64,<data>
  // Pattern: data:<mime>;enc=gzip;base64,<data>
  const commaIndex = uri.indexOf(',')
  if (commaIndex === -1) return null

  const header = uri.slice(0, commaIndex).toLowerCase()
  const base64Data = uri.slice(commaIndex + 1)
  const raw = Buffer.from(base64Data, 'base64')

  if (header.includes('enc=gzip')) {
    try {
      return gunzipSync(raw)
    } catch {
      return null
    }
  }

  return raw
}

function ipfsGatewayCandidates(ipfsUri: string, gateways: string[]): string[] {
  const cidPath = ipfsUri.slice(7).replace(/^\/+/, '')
  return gateways.map((base) => `${base.replace(/\/$/, '')}/${cidPath}`)
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)))
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 2)))
  return Math.min(maxDelayMs, exponential + jitter)
}

async function fetchHttpContentWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
  baseDelayMs: number,
  maxDelayMs: number,
): Promise<Buffer | null> {
  const maxAttempts = Math.max(1, retries + 1)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now()

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'ERC8004-Scanner/1.0' },
      })

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer()
        return Buffer.from(arrayBuffer)
      }

      const retryable = isRetryableStatus(response.status)
      const elapsedMs = Date.now() - start
      log({
        level: retryable ? 'warn' : 'info',
        msg: `HTTP ${response.status} fetching ${url} (attempt ${attempt}/${maxAttempts}, ${elapsedMs}ms)`,
      })

      if (!retryable || attempt >= maxAttempts) {
        return null
      }
    } catch (error) {
      const elapsedMs = Date.now() - start
      const name = error instanceof Error ? error.name : 'UnknownError'
      log({
        level: 'warn',
        msg: `Fetch error (${name}) for ${url} (attempt ${attempt}/${maxAttempts}, ${elapsedMs}ms)`,
      })

      if (attempt >= maxAttempts) {
        return null
      }
    }

    await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs))
  }

  return null
}

async function fetchIpfsWithFallback(uri: string): Promise<Buffer | null> {
  const candidates = ipfsGatewayCandidates(uri, env.IPFS_GATEWAY_URLS)

  for (const candidateUrl of candidates) {
    const result = await fetchHttpContentWithRetry(
      candidateUrl,
      env.METADATA_IPFS_TIMEOUT_MS,
      env.METADATA_FETCH_RETRIES,
      env.METADATA_RETRY_BASE_DELAY_MS,
      env.METADATA_RETRY_MAX_DELAY_MS,
    )
    if (result !== null) {
      return result
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a JSON registration file from URI content.
 */
export function parseRegistrationJson(content: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content.toString('utf-8')) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
