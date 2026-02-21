import type { AgentMetadataRawSnapshot } from '../types/mongo'
import { MongoPoolManager } from '../utils/mongoPoolManager'
import type { MongoDBClient, IndexDefinition } from '../utils/mongodb'

const COLLECTION_NAME = 'agent_metadata_raw'

const INDEXES: IndexDefinition[] = [
  { key: { id: 1 }, name: 'idx_agent_metadata_raw_id_unique', unique: true },
  { key: { chainId: 1, agentId: 1, resolvedAt: -1 }, name: 'idx_agent_metadata_raw_chain_agent_resolved' },
  { key: { chainId: 1, uriHash: 1 }, name: 'idx_agent_metadata_raw_chain_uri_hash' },
]

let client: MongoDBClient<AgentMetadataRawSnapshot> | null = null

export async function getAgentMetadataRawClient(): Promise<MongoDBClient<AgentMetadataRawSnapshot>> {
  if (client !== null) return client
  client = await MongoPoolManager.getInstance().createClient<AgentMetadataRawSnapshot>(COLLECTION_NAME, INDEXES)
  return client
}

export async function upsertAgentMetadataRawSnapshot(snapshot: AgentMetadataRawSnapshot): Promise<void> {
  const db = await getAgentMetadataRawClient()
  await db.upsert(snapshot, { id: snapshot.id })
}
