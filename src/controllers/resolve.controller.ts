import { Router, Request, Response } from 'express'
import { log } from '../utils/logger'

const FETCH_TIMEOUT_MS = 10_000
const IPFS_TIMEOUT_MS = 30_000
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB

const ALLOWED_HTTP_PROTOCOLS = ['http:', 'https:']
const IMAGE_CONTENT_TYPE_PREFIX = 'image/'
const HTTP_IMAGE_CACHE_SECONDS = 86400      // 24 hours
const IPFS_IMAGE_CACHE_SECONDS = 31536000   // 1 year (content-addressed, immutable)
const HTTP_IMAGE_ACCEPT_HEADER = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
const HTTP_IMAGE_USER_AGENT = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/122.0.0.0',
  'Safari/537.36',
].join(' ')

/**
 * Validate that the provided string is a well-formed URL with one of the given protocols.
 * Returns the parsed URL on success, or null on failure.
 */
function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function stringifyFetchError(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'Unknown fetch error'
  }

  const cause = typeof (err as { cause?: unknown }).cause === 'object'
    ? (err as { cause?: { message?: unknown } }).cause
    : undefined
  const causeMessage = cause && typeof cause.message === 'string' ? cause.message : null

  return causeMessage ? `${err.message} (${causeMessage})` : err.message
}

// ---------------------------------------------------------------------------
// Lazy IPFS verified-fetch singleton
// ---------------------------------------------------------------------------

type IpfsFetchFn = (resource: string, init?: RequestInit) => Promise<globalThis.Response>

let ipfsFetchInstance: IpfsFetchFn | null = null
let ipfsFetchInitPromise: Promise<IpfsFetchFn> | null = null

/**
 * Perform a native ESM dynamic import that TypeScript will not transpile to require().
 * This is necessary because @helia/verified-fetch is ESM-only and the project
 * compiles with "module": "commonjs".
 */
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ createVerifiedFetch: (...args: unknown[]) => Promise<unknown> }>

async function getIpfsFetch(): Promise<IpfsFetchFn> {
  if (ipfsFetchInstance) {
    return ipfsFetchInstance
  }

  if (ipfsFetchInitPromise) {
    return ipfsFetchInitPromise
  }

  ipfsFetchInitPromise = (async () => {
    log({ level: 'info', msg: 'Initializing IPFS verified-fetch client...' })
    const { createVerifiedFetch } = await importEsm('@helia/verified-fetch')
    const vf = await createVerifiedFetch({
      gateways: ['https://trustless-gateway.link'],
      routers: ['http://delegated-ipfs.dev'],
    })
    log({ level: 'info', msg: 'IPFS verified-fetch client ready' })
    ipfsFetchInstance = vf as unknown as IpfsFetchFn
    return ipfsFetchInstance
  })()

  return ipfsFetchInitPromise
}

// ---------------------------------------------------------------------------
// HTTP fetch helper
// ---------------------------------------------------------------------------

async function resolveHttpUri(url: string, res: Response): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: globalThis.Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, */*' },
    })
  } catch (err) {
    clearTimeout(timer)

    if (err instanceof DOMException && err.name === 'AbortError') {
      res.status(504).json({ error: 'Upstream request timed out' })
      return
    }

    const message = err instanceof Error ? err.message : 'Unknown fetch error'
    log({ level: 'warn', msg: `Resolve proxy fetch failed: ${message}`, meta: { url } })
    res.status(502).json({ error: `Upstream fetch failed: ${message}` })
    return
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    res.status(502).json({ error: `Upstream returned HTTP ${response.status} ${response.statusText}` })
    return
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    res.status(502).json({ error: 'Upstream response too large' })
    return
  }

  const text = await response.text()
  if (text.length > MAX_BODY_BYTES) {
    res.status(502).json({ error: 'Upstream response too large' })
    return
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    res.status(200).json({ contentType: 'text/plain', body: text })
    return
  }

  res.status(200).json({ contentType: 'application/json', body: json })
}

// ---------------------------------------------------------------------------
// IPFS fetch helper
// ---------------------------------------------------------------------------

async function resolveIpfsUri(uri: string, res: Response): Promise<void> {
  let ipfsFetch: IpfsFetchFn
  try {
    ipfsFetch = await getIpfsFetch()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log({ level: 'error', msg: 'Failed to initialize IPFS client', error: err })
    res.status(500).json({ error: `IPFS client initialization failed: ${message}` })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IPFS_TIMEOUT_MS)

  let response: globalThis.Response
  try {
    response = await ipfsFetch(uri, { signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)

    if (err instanceof Error && err.name === 'AbortError') {
      res.status(504).json({ error: 'IPFS request timed out' })
      return
    }

    const message = err instanceof Error ? err.message : 'Unknown IPFS fetch error'
    log({ level: 'warn', msg: `IPFS resolve failed: ${message}`, meta: { uri } })
    res.status(502).json({ error: `IPFS fetch failed: ${message}` })
    return
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    res.status(502).json({ error: `IPFS gateway returned HTTP ${response.status}` })
    return
  }

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  if (isJson) {
    try {
      const json: unknown = await response.json()
      res.status(200).json({ contentType: 'application/json', body: json })
      return
    } catch {
      // Fall through to text
    }
  }

  const text = await response.text()
  if (text.length > MAX_BODY_BYTES) {
    res.status(502).json({ error: 'IPFS response too large' })
    return
  }

  // Try parsing as JSON even if content-type didn't say so
  try {
    const json: unknown = JSON.parse(text)
    res.status(200).json({ contentType: 'application/json', body: json })
    return
  } catch {
    // Not JSON
  }

  res.status(200).json({ contentType: contentType || 'application/octet-stream', body: text })
}

// ---------------------------------------------------------------------------
// HTTP image proxy helper
// ---------------------------------------------------------------------------

async function proxyHttpImage(url: string, res: Response): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: globalThis.Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: HTTP_IMAGE_ACCEPT_HEADER,
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': HTTP_IMAGE_USER_AGENT,
      },
    })
  } catch (err) {
    clearTimeout(timer)

    if (err instanceof DOMException && err.name === 'AbortError') {
      res.status(504).json({ error: 'Upstream image request timed out' })
      return
    }

    const message = stringifyFetchError(err)
    log({ level: 'warn', msg: `Image proxy fetch failed: ${message}`, meta: { url } })
    res.status(502).json({ error: `Upstream image fetch failed: ${message}` })
    return
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    res.status(502).json({
      error: `Upstream returned HTTP ${response.status} ${response.statusText}`,
    })
    return
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith(IMAGE_CONTENT_TYPE_PREFIX)) {
    res.status(502).json({ error: `Upstream response is not an image (${contentType})` })
    return
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    res.status(502).json({ error: 'Upstream image too large' })
    return
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_BODY_BYTES) {
    res.status(502).json({ error: 'Upstream image too large' })
    return
  }

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', arrayBuffer.byteLength.toString())
  res.setHeader('Cache-Control', `public, max-age=${HTTP_IMAGE_CACHE_SECONDS}`)
  res.status(200).end(Buffer.from(arrayBuffer))
}

// ---------------------------------------------------------------------------
// IPFS image proxy helper
// ---------------------------------------------------------------------------

async function proxyIpfsImage(uri: string, res: Response): Promise<void> {
  let ipfsFetch: IpfsFetchFn
  try {
    ipfsFetch = await getIpfsFetch()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log({ level: 'error', msg: 'Failed to initialize IPFS client for image proxy', error: err })
    res.status(500).json({ error: `IPFS client initialization failed: ${message}` })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IPFS_TIMEOUT_MS)

  let response: globalThis.Response
  try {
    response = await ipfsFetch(uri, { signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)

    if (err instanceof Error && err.name === 'AbortError') {
      res.status(504).json({ error: 'IPFS image request timed out' })
      return
    }

    const message = err instanceof Error ? err.message : 'Unknown IPFS fetch error'
    log({ level: 'warn', msg: `IPFS image proxy failed: ${message}`, meta: { uri } })
    res.status(502).json({ error: `IPFS image fetch failed: ${message}` })
    return
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    res.status(502).json({ error: `IPFS gateway returned HTTP ${response.status}` })
    return
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith(IMAGE_CONTENT_TYPE_PREFIX)) {
    res.status(502).json({ error: `IPFS response is not an image (${contentType})` })
    return
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_BODY_BYTES) {
    res.status(502).json({ error: 'IPFS image too large' })
    return
  }

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', arrayBuffer.byteLength.toString())
  res.setHeader('Cache-Control', `public, max-age=${IPFS_IMAGE_CACHE_SECONDS}, immutable`)
  res.status(200).end(Buffer.from(arrayBuffer))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Controller for URI resolution proxy endpoints.
 *
 * Provides server-side fetching of external URIs to bypass browser CORS restrictions.
 * Supports HTTP(S) and IPFS (via @helia/verified-fetch) protocols.
 */
export function createResolveRouter(): Router {
  const router = Router()

  /**
   * GET /v1/resolve/uri?url=<encoded-url>
   *
   * Fetches the given URL server-side and returns the parsed JSON body.
   * Supports http://, https://, and ipfs:// protocols.
   */
  router.get('/uri', async (req: Request, res: Response) => {
    try {
      const rawUrl = req.query.url as string | undefined
      if (!rawUrl || rawUrl.trim().length === 0) {
        res.status(400).json({ error: 'Query parameter "url" is required' })
        return
      }

      const trimmed = rawUrl.trim()
      const parsed = parseUrl(trimmed)
      if (!parsed) {
        res.status(400).json({ error: 'Invalid URL format' })
        return
      }

      if (ALLOWED_HTTP_PROTOCOLS.includes(parsed.protocol)) {
        await resolveHttpUri(parsed.href, res)
        return
      }

      if (parsed.protocol === 'ipfs:') {
        await resolveIpfsUri(trimmed, res)
        return
      }

      res.status(400).json({ error: `Unsupported protocol: ${parsed.protocol}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log({ level: 'error', msg: 'Resolve proxy error', error })
      res.status(500).json({ error: `Resolve failed: ${message}` })
    }
  })

  /**
   * GET /v1/resolve/image?url=<encoded-url>
   *
   * Proxies an image from the given URL, returning raw bytes with the
   * original Content-Type header. Data URIs are rejected (render directly).
   */
  router.get('/image', async (req: Request, res: Response) => {
    try {
      const rawUrl = req.query.url as string | undefined
      if (!rawUrl || rawUrl.trim().length === 0) {
        res.status(400).json({ error: 'Query parameter "url" is required' })
        return
      }

      const trimmed = rawUrl.trim()

      if (trimmed.startsWith('data:')) {
        res.status(400).json({ error: 'Data URIs should be rendered directly by the client' })
        return
      }

      const parsed = parseUrl(trimmed)
      if (!parsed) {
        res.status(400).json({ error: 'Invalid URL format' })
        return
      }

      if (ALLOWED_HTTP_PROTOCOLS.includes(parsed.protocol)) {
        await proxyHttpImage(parsed.href, res)
        return
      }

      if (parsed.protocol === 'ipfs:') {
        await proxyIpfsImage(trimmed, res)
        return
      }

      res.status(400).json({ error: `Unsupported protocol: ${parsed.protocol}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log({ level: 'error', msg: 'Image proxy error', error })
      res.status(500).json({ error: `Image proxy failed: ${message}` })
    }
  })

  return router
}
