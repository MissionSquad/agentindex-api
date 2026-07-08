import { Router, Request, Response } from 'express'
import { getChainSyncState } from '../repositories/chain-state.repository'
import type { HealthResponse } from '../types/api'
import { env } from '../env'

export interface CachedLatestBlock {
  value: number
  /** Epoch ms when the RPC heartbeat last refreshed the value. */
  at: number
}

export function createHealthRouter(
  getCachedLatestBlock: (() => CachedLatestBlock | null) | null,
): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const chainId = env.CHAIN_ID
      const syncState = await getChainSyncState(chainId)

      // Served from the scanner's RPC heartbeat cache. Health probes must never
      // issue live RPC calls: during an RPC outage every probe would stall for
      // the full request timeout and pile more requests onto the failing node.
      const latestBlock = getCachedLatestBlock?.()?.value ?? null

      const lastSynced = syncState?.lastSyncedBlock ?? null
      const syncLag = latestBlock !== null && lastSynced !== null
        ? latestBlock - lastSynced
        : null

      const response: HealthResponse = {
        status: syncLag !== null && syncLag < 100 ? 'ok' : 'degraded',
        chainId,
        network: env.NETWORK_NAME,
        lastSyncedBlock: lastSynced,
        latestChainBlock: latestBlock,
        syncLag,
        timestamp: new Date().toISOString(),
      }

      res.json(response)
    } catch (error) {
      res.status(500).json({ error: 'Health check failed' })
    }
  })

  return router
}
