import { Router, Request, Response } from 'express'
import { env } from '../env'
import { buildNetworkGraph } from '../services/network-graph.service'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const GLOBAL_WINDOW_DEFAULT_DAYS = 3
const GLOBAL_WINDOW_MAX_DAYS = 14
const GLOBAL_LIMIT_DEFAULT = 250
const GLOBAL_LIMIT_MAX = 500

function toTimestampMs(value: number): number {
  if (value > 0 && value < 1_000_000_000_000) {
    return value * 1000
  }
  return value
}

export function createNetworkRouter(): Router {
  const router = Router()

  /**
   * GET /v1/network/graph
   * Trust network graph data for visualization.
   */
  router.get('/graph', async (req: Request, res: Response) => {
    try {
      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const parsedAgentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined
      const agentId = parsedAgentId !== undefined && !isNaN(parsedAgentId)
        ? parsedAgentId
        : undefined

      const parsedMinWeight = req.query.minWeight ? parseInt(req.query.minWeight as string, 10) : undefined
      const minWeight = parsedMinWeight !== undefined && !isNaN(parsedMinWeight)
        ? parsedMinWeight
        : undefined

      const parsedSince = req.query.since ? Number(req.query.since) : undefined
      const since = parsedSince !== undefined && Number.isFinite(parsedSince)
        ? parsedSince
        : undefined

      const parsedUntil = req.query.until ? Number(req.query.until) : undefined
      const until = parsedUntil !== undefined && Number.isFinite(parsedUntil)
        ? parsedUntil
        : undefined

      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
      let limit = parsedLimit !== undefined && !isNaN(parsedLimit)
        ? parsedLimit
        : undefined

      const address = typeof req.query.address === 'string'
        ? req.query.address.toLowerCase()
        : undefined

      let effectiveSince = since
      let effectiveUntil = until

      const isGlobalView = agentId === undefined && address === undefined
      const nowMs = Date.now()

      if (isGlobalView) {
        if (effectiveSince === undefined) {
          const baselineUntilMs = toTimestampMs(effectiveUntil ?? nowMs)
          effectiveSince = Math.floor((baselineUntilMs - (GLOBAL_WINDOW_DEFAULT_DAYS * MS_PER_DAY)) / 1000)
        }

        const sinceMs = toTimestampMs(effectiveSince)
        const untilMs = toTimestampMs(effectiveUntil ?? nowMs)

        if (untilMs < sinceMs) {
          res.status(400).json({ error: '`until` must be greater than or equal to `since`.' })
          return
        }

        const windowMs = untilMs - sinceMs
        if (windowMs > (GLOBAL_WINDOW_MAX_DAYS * MS_PER_DAY)) {
          res.status(400).json({
            error: `Global network window cannot exceed ${GLOBAL_WINDOW_MAX_DAYS} days. Add agentId/address for larger windows.`,
          })
          return
        }

        limit = Math.max(1, Math.min(GLOBAL_LIMIT_MAX, limit ?? GLOBAL_LIMIT_DEFAULT))
      } else if (effectiveSince !== undefined && effectiveUntil !== undefined) {
        const sinceMs = toTimestampMs(effectiveSince)
        const untilMs = toTimestampMs(effectiveUntil)

        if (untilMs < sinceMs) {
          res.status(400).json({ error: '`until` must be greater than or equal to `since`.' })
          return
        }
      }

      const payload = await buildNetworkGraph({
        chainId,
        agentId,
        address,
        minWeight,
        since: effectiveSince,
        until: effectiveUntil,
        limit,
      })

      res.json(payload)
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch network graph' })
    }
  })

  return router
}
