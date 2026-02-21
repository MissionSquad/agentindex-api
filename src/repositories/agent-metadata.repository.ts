import type { AgentMetadata } from '../types/mongo'
import { MongoPoolManager } from '../utils/mongoPoolManager'
import type { MongoDBClient, IndexDefinition } from '../utils/mongodb'

const COLLECTION_NAME = 'agent_metadata'

const INDEXES: IndexDefinition[] = [
  { key: { id: 1 }, name: 'idx_agent_metadata_id_unique', unique: true },
  { key: { chainId: 1, agentId: 1 }, name: 'idx_agent_metadata_chain_agent', unique: true },
  { key: { chainId: 1, resolveStatus: 1 }, name: 'idx_agent_metadata_status' },
  { key: { chainId: 1, x402Support: 1 }, name: 'idx_agent_metadata_x402' },
  { key: { chainId: 1, services: 1 }, name: 'idx_agent_metadata_services' },
  { key: { chainId: 1, serviceEndpoints: 1 }, name: 'idx_agent_metadata_service_endpoints' },
  { key: { chainId: 1, serviceSkills: 1 }, name: 'idx_agent_metadata_service_skills' },
  { key: { chainId: 1, serviceTools: 1 }, name: 'idx_agent_metadata_service_tools' },
  { key: { chainId: 1, serviceCapabilities: 1 }, name: 'idx_agent_metadata_service_capabilities' },
  { key: { chainId: 1, registrationRegistries: 1 }, name: 'idx_agent_metadata_registration_registries' },
  { key: { chainId: 1, attributeProtocols: 1 }, name: 'idx_agent_metadata_attribute_protocols' },
  { key: { chainId: 1, attributeDataFeeds: 1 }, name: 'idx_agent_metadata_attribute_data_feeds' },
  { key: { chainId: 1, attributeTags: 1 }, name: 'idx_agent_metadata_attribute_tags' },
  { key: { chainId: 1, attributeBlockchains: 1 }, name: 'idx_agent_metadata_attribute_blockchains' },
  { key: { chainId: 1, contactEmails: 1 }, name: 'idx_agent_metadata_contact_emails' },
  { key: { chainId: 1, contactTwitter: 1 }, name: 'idx_agent_metadata_contact_twitter' },
  { key: { chainId: 1, searchTerms: 1 }, name: 'idx_agent_metadata_search_terms' },
  { key: { chainId: 1, name: 1 }, name: 'idx_agent_metadata_name' },
]

let client: MongoDBClient<AgentMetadata> | null = null

export async function getAgentMetadataClient(): Promise<MongoDBClient<AgentMetadata>> {
  if (client !== null) return client
  client = await MongoPoolManager.getInstance().createClient<AgentMetadata>(COLLECTION_NAME, INDEXES)
  return client
}

export async function upsertAgentMetadata(metadata: AgentMetadata): Promise<void> {
  const db = await getAgentMetadataClient()
  await db.upsert(metadata, { id: metadata.id })
}

export async function upsertAgentMetadataBatch(items: AgentMetadata[]): Promise<void> {
  if (items.length === 0) return
  const db = await getAgentMetadataClient()
  await db.upsertBulk(items.map((item) => ({ item, filter: { id: item.id } })))
}

export async function getAgentMetadataByAgent(
  chainId: number,
  agentId: number,
): Promise<AgentMetadata | null> {
  const db = await getAgentMetadataClient()
  return db.findOne({ chainId, agentId })
}

export async function getAgentMetadataBatch(
  chainId: number,
  agentIds: number[],
): Promise<AgentMetadata[]> {
  if (agentIds.length === 0) return []
  const uniqueIds = Array.from(new Set(agentIds))
  const db = await getAgentMetadataClient()
  return db.find({ chainId, agentId: { $in: uniqueIds } })
}

export async function getAgentMetadataByStatus(
  chainId: number,
  status: 'resolved' | 'failed' | 'pending',
  limit: number = 100,
): Promise<AgentMetadata[]> {
  const db = await getAgentMetadataClient()
  return db.find({ chainId, resolveStatus: status }, { resolvedAt: 1 }, limit)
}
