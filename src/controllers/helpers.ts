import type { ParsedPagination } from '../types/api'

/**
 * Parse pagination query parameters from Express request.
 */
export function parsePagination(query: Record<string, unknown>): ParsedPagination {
  const page = Math.max(1, parseInt(query.page as string, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string, 10) || 20))
  const skip = (page - 1) * limit
  const sortField = (query.sort as string) || 'blockNumber'
  const order = (query.order as string) === 'asc' ? 1 : -1
  const chainId = query.chainId ? parseInt(query.chainId as string, 10) : undefined

  return {
    page,
    limit,
    skip,
    sort: { [sortField]: order as 1 | -1 },
    chainId: chainId && !isNaN(chainId) ? chainId : undefined,
  }
}

/**
 * Set SSE headers on an Express response.
 */
export function setSSEHeaders(res: { setHeader: (key: string, value: string) => void }): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
}
