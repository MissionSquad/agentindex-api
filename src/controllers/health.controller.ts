import { Router, Request, Response } from 'express'
import { getChainSyncState } from '../repositories/chain-state.repository'
import type { ScannerService } from '../services/scanner.service'
import type { HealthResponse } from '../types/api'
import { env } from '../env'

export function createHealthRouter(scanner: ScannerService | null): Router {
  const router = Router()

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const chainId = env.CHAIN_ID
      const syncState = await getChainSyncState(chainId)
      let latestBlock: number | null = null

      try {
        if (scanner) {
          latestBlock = await scanner.getLatestBlockNumber()
        }
      } catch {
        // Scanner may not be initialized
      }

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
