import { log } from '../utils/logger'

/**
 * Fetches off-chain content from agentURI, feedbackURI, or responseURI.
 * Supports data: URIs (base64, gzip+base64), ipfs://, and https://.
 */
export async function fetchOffchainContent(uri: string): Promise<Buffer | null> {
  if (!uri) return null

  try {
    if (uri.startsWith('data:')) {
      return decodeDataUri(uri)
    }

    if (uri.startsWith('ipfs://')) {
      const cid = uri.slice(7)
      const gatewayUrl = `https://ipfs.io/ipfs/${cid}`
      return await fetchHttpContent(gatewayUrl)
    }

    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return await fetchHttpContent(uri)
    }

    log({ level: 'warn', msg: `Unsupported URI scheme: ${uri.slice(0, 30)}` })
    return null
  } catch (error) {
    log({ level: 'warn', msg: `Failed to fetch off-chain content: ${uri.slice(0, 80)}`, error })
    return null
  }
}

function decodeDataUri(uri: string): Buffer | null {
  // Pattern: data:<mime>;base64,<data>
  // Pattern: data:<mime>;enc=gzip;base64,<data>
  const commaIndex = uri.indexOf(',')
  if (commaIndex === -1) return null

  const base64Data = uri.slice(commaIndex + 1)
  return Buffer.from(base64Data, 'base64')
}

async function fetchHttpContent(url: string): Promise<Buffer | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'ERC8004-Scanner/1.0' },
  })

  if (!response.ok) {
    log({ level: 'warn', msg: `HTTP ${response.status} fetching ${url}` })
    return null
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Parse a JSON registration file from URI content.
 */
export function parseRegistrationJson(content: Buffer): Record<string, unknown> | null {
  try {
    return JSON.parse(content.toString('utf-8'))
  } catch {
    return null
  }
}
