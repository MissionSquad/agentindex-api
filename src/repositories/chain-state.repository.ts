import type { ChainSyncState } from '../types/mongo'
import type { MongoDBClient } from '../utils/mongodb'
import { MongoPoolManager } from '../utils/mongoPoolManager'
import { log } from '../utils/logger'

let client: MongoDBClient<ChainSyncState> | null = null

export async function getChainStateClient(): Promise<MongoDBClient<ChainSyncState>> {
  if (client) return client
  client = await MongoPoolManager.getInstance().createClient<ChainSyncState>(
    'chain_sync_state',
    [{ key: { chainId: 1 }, name: 'idx_chainId_unique', unique: true }],
  )
  return client
}

export async function getChainSyncState(chainId: number): Promise<ChainSyncState | null> {
  const db = await getChainStateClient()
  return db.findOne({ chainId } as Partial<ChainSyncState>)
}

export async function upsertChainSyncState(state: ChainSyncState): Promise<void> {
  const db = await getChainStateClient()
  await db.upsert(state, { chainId: state.chainId } as Partial<ChainSyncState>)
  log({ level: 'debug', msg: `Chain sync state updated: block ${state.lastSyncedBlock}` })
}
