import type { EventFact } from '../types/mongo'
import type { MongoDBClient } from '../utils/mongodb'
import { MongoPoolManager } from '../utils/mongoPoolManager'

let client: MongoDBClient<EventFact> | null = null

export async function getEventFactClient(): Promise<MongoDBClient<EventFact>> {
  if (client) return client
  client = await MongoPoolManager.getInstance().createClient<EventFact>(
    'event_fact',
    [
      { key: { chainId: 1, txHash: 1, logIndex: 1 }, name: 'idx_event_unique', unique: true },
      { key: { chainId: 1, eventName: 1, blockNumber: -1 }, name: 'idx_event_name_block' },
      { key: { chainId: 1, topic0: 1, blockNumber: -1 }, name: 'idx_event_topic0_block' },
      { key: { chainId: 1, blockNumber: -1, logIndex: 1 }, name: 'idx_event_block_log' },
      { key: { chainId: 1, registryAddress: 1, eventName: 1, blockNumber: -1 }, name: 'idx_event_registry_name_block' },
    ],
  )
  return client
}

export async function upsertEventFact(fact: EventFact): Promise<void> {
  const db = await getEventFactClient()
  await db.upsert(fact, {
    chainId: fact.chainId,
    txHash: fact.txHash,
    logIndex: fact.logIndex,
  } as Partial<EventFact>)
}

export async function upsertEventBatch(facts: EventFact[]): Promise<void> {
  if (facts.length === 0) return
  const db = await getEventFactClient()
  await db.upsertBulk(facts.map((f) => ({
    item: f,
    filter: {
      chainId: f.chainId,
      txHash: f.txHash,
      logIndex: f.logIndex,
    } as Partial<EventFact>,
  })))
}

export async function deleteEventFactsByBlock(chainId: number, blockNumber: number): Promise<void> {
  const db = await getEventFactClient()
  await db.delete({ chainId, blockNumber } as Partial<EventFact>)
}
