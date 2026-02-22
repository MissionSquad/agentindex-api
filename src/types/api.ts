import type { Request } from 'express'

/** Standard paginated list query parameters */
export interface PaginationQuery {
  page?: string
  limit?: string
  sort?: string
  order?: 'asc' | 'desc'
  chainId?: string
  cursor?: string
}

/** Parsed pagination parameters */
export interface ParsedPagination {
  page: number
  limit: number
  skip: number
  sort: Record<string, 1 | -1>
  chainId: number | undefined
}

/** Standard paginated response envelope */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

/** Health check response */
export interface HealthResponse {
  status: 'ok' | 'degraded'
  chainId: number
  network: string
  lastSyncedBlock: number | null
  latestChainBlock: number | null
  syncLag: number | null
  timestamp: string
}

/** A metric with values scoped to 24h, 7d, and 30d time windows. */
export interface WindowedValue {
  d24h: number | null
  d7d: number | null
  d30d: number | null
}

/** Analytics overview response */
export interface AnalyticsOverview {
  totalAgents: number
  newAgents24h: number
  newAgents7d: number
  newAgents30d: number
  totalFeedback: number
  activeFeedback: number
  uniqueClients: number
  totalResponses: number
  agentTransfers: number
  ecosystemGrowthVelocity: number | null
  feedbackDensity: number | null
  revocationRate: number | null
  dormantAgentRatio: number | null
  responseEngagementRate: number | null
  transferRate: number | null
  windowedHeuristics: {
    ecosystemGrowthVelocity: WindowedValue
    feedbackDensity: WindowedValue
    dormantAgentRatio: WindowedValue
    responseEngagementRate: WindowedValue
    transferRate: WindowedValue
  }
}

export interface DashboardActivityItem {
  chainId: number
  eventName: string
  agentId: string | null
  agentName: string | null
  agentImageUrl: string | null
  txHash: string
  logIndex: number
  timestamp: number
  summary: string
}

export type DashboardActivityStreamMessage =
  | { type: 'connected'; timestamp: number }
  | { type: 'activity'; item: DashboardActivityItem }

/** SSE event data types */
export type SSEEventType =
  | 'transaction'
  | 'registration'
  | 'feedback'
  | 'revocation'
  | 'response'
  | 'transfer'
  | 'uri_update'
  | 'metadata_set'

export interface SSEEvent {
  type: SSEEventType
  data: Record<string, unknown>
  timestamp: number
}

/** Express request with parsed query */
export interface TypedRequest<Q = Record<string, string>> extends Request {
  query: Q & Record<string, string>
}
