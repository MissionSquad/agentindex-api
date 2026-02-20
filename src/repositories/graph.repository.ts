import type {
  ReviewEdge,
  RegistrantEdge,
  AgentReviewEdge,
  ResponseEdge,
  GraphComponentSnapshot,
} from '../types/mongo'
import type { MongoDBClient } from '../utils/mongodb'
import { MongoPoolManager } from '../utils/mongoPoolManager'

let reviewClient: MongoDBClient<ReviewEdge> | null = null
let registrantClient: MongoDBClient<RegistrantEdge> | null = null
let agentReviewClient: MongoDBClient<AgentReviewEdge> | null = null
let responseClient: MongoDBClient<ResponseEdge> | null = null
let snapshotClient: MongoDBClient<GraphComponentSnapshot> | null = null

export async function getReviewEdgeClient(): Promise<MongoDBClient<ReviewEdge>> {
  if (reviewClient) return reviewClient
  reviewClient = await MongoPoolManager.getInstance().createClient<ReviewEdge>(
    'review_edge',
    [
      { key: { feedbackId: 1 }, name: 'idx_review_feedbackId_unique', unique: true },
      { key: { chainId: 1, targetAgentId: 1, timestamp: -1 }, name: 'idx_review_agent_ts' },
      { key: { chainId: 1, clientAddress: 1, timestamp: -1 }, name: 'idx_review_client_ts' },
    ],
  )
  return reviewClient
}

export async function getRegistrantEdgeClient(): Promise<MongoDBClient<RegistrantEdge>> {
  if (registrantClient) return registrantClient
  registrantClient = await MongoPoolManager.getInstance().createClient<RegistrantEdge>(
    'registrant_edge',
    [
      { key: { chainId: 1, sourceAgentId: 1 }, name: 'idx_registrant_agentId_unique', unique: true },
      { key: { chainId: 1, ownerAddress: 1 }, name: 'idx_registrant_owner' },
    ],
  )
  return registrantClient
}

export async function getAgentReviewEdgeClient(): Promise<MongoDBClient<AgentReviewEdge>> {
  if (agentReviewClient) return agentReviewClient
  agentReviewClient = await MongoPoolManager.getInstance().createClient<AgentReviewEdge>(
    'agent_review_edge',
    [
      { key: { feedbackId: 1 }, name: 'idx_agent_review_feedbackId_unique', unique: true },
      { key: { chainId: 1, sourceAgentId: 1, targetAgentId: 1 }, name: 'idx_agent_review_pair' },
      { key: { chainId: 1, targetAgentId: 1, timestamp: -1 }, name: 'idx_agent_review_target_ts' },
    ],
  )
  return agentReviewClient
}

export async function getResponseEdgeClient(): Promise<MongoDBClient<ResponseEdge>> {
  if (responseClient) return responseClient
  responseClient = await MongoPoolManager.getInstance().createClient<ResponseEdge>(
    'response_edge',
    [
      { key: { chainId: 1, feedbackId: 1, txHash: 1, logIndex: 1 }, name: 'idx_response_unique', unique: true },
      { key: { chainId: 1, responder: 1, timestamp: -1 }, name: 'idx_response_responder_ts' },
      { key: { chainId: 1, targetAgentId: 1, timestamp: -1 }, name: 'idx_response_agent_ts' },
    ],
  )
  return responseClient
}

export async function getGraphSnapshotClient(): Promise<MongoDBClient<GraphComponentSnapshot>> {
  if (snapshotClient) return snapshotClient
  snapshotClient = await MongoPoolManager.getInstance().createClient<GraphComponentSnapshot>(
    'graph_component_snapshot',
    [
      { key: { snapshotDate: 1, componentId: 1 }, name: 'idx_snapshot_date_comp', unique: true },
    ],
  )
  return snapshotClient
}

export async function upsertReviewEdge(edge: ReviewEdge): Promise<void> {
  const db = await getReviewEdgeClient()
  await db.upsert(edge, { feedbackId: edge.feedbackId } as Partial<ReviewEdge>)
}

export async function upsertRegistrantEdge(edge: RegistrantEdge): Promise<void> {
  const db = await getRegistrantEdgeClient()
  await db.upsert(edge, { chainId: edge.chainId, sourceAgentId: edge.sourceAgentId } as Partial<RegistrantEdge>)
}

export async function upsertAgentReviewEdge(edge: AgentReviewEdge): Promise<void> {
  const db = await getAgentReviewEdgeClient()
  await db.upsert(edge, { feedbackId: edge.feedbackId } as Partial<AgentReviewEdge>)
}

export async function upsertResponseEdge(edge: ResponseEdge): Promise<void> {
  const db = await getResponseEdgeClient()
  await db.upsert(edge, {
    chainId: edge.chainId,
    feedbackId: edge.feedbackId,
    txHash: edge.txHash,
    logIndex: edge.logIndex,
  } as Partial<ResponseEdge>)
}

export async function upsertGraphEdgeBatch(
  reviews: ReviewEdge[],
  registrants: RegistrantEdge[],
  agentReviews: AgentReviewEdge[],
  responses: ResponseEdge[],
): Promise<void> {
  if (reviews.length > 0) {
    const db = await getReviewEdgeClient()
    await db.upsertBulk(reviews.map((e) => ({ item: e, filter: { feedbackId: e.feedbackId } as Partial<ReviewEdge> })))
  }
  if (registrants.length > 0) {
    const db = await getRegistrantEdgeClient()
    await db.upsertBulk(registrants.map((e) => ({
      item: e,
      filter: { chainId: e.chainId, sourceAgentId: e.sourceAgentId } as Partial<RegistrantEdge>,
    })))
  }
  if (agentReviews.length > 0) {
    const db = await getAgentReviewEdgeClient()
    await db.upsertBulk(agentReviews.map((e) => ({
      item: e,
      filter: { feedbackId: e.feedbackId } as Partial<AgentReviewEdge>,
    })))
  }
  if (responses.length > 0) {
    const db = await getResponseEdgeClient()
    await db.upsertBulk(responses.map((e) => ({
      item: e,
      filter: {
        chainId: e.chainId,
        feedbackId: e.feedbackId,
        txHash: e.txHash,
        logIndex: e.logIndex,
      } as Partial<ResponseEdge>,
    })))
  }
}

export async function deleteGraphEdgesByBlock(chainId: number, blockNumber: number): Promise<void> {
  // Review edges and response edges have timestamps but not blockNumbers directly.
  // For reorg rollback, we join through event_facts. This is handled at the service level.
}
