import type { Document } from 'mongodb'
import {
  getAgentReviewEdgeClient,
  getRegistrantEdgeClient,
  getResponseEdgeClient,
  getReviewEdgeClient,
} from '../repositories/graph.repository'

export interface NetworkNodeDto {
  id?: string
  chainId?: number
  agentId?: string
  address?: string
  kind?: 'agent' | 'address' | 'feedback'
  name?: string
  meta?: Record<string, unknown>
}

export interface NetworkEdgeDto {
  id?: string
  source: string
  target: string
  kind: 'review' | 'registrant' | 'agent-review' | 'response'
  weight?: number
  firstSeen?: number
  lastSeen?: number
  txHash?: string
}

export interface NetworkGraphDto {
  nodes: NetworkNodeDto[]
  edges: NetworkEdgeDto[]
  metrics: {
    reciprocalReviewRatioGlobal: number | null
    isolatedClusterShare: number | null
    networkBridgeCount: number
  }
  meta: {
    edgeLimitApplied: number
    truncated: boolean
  }
}

export interface BuildNetworkGraphOptions {
  chainId: number
  agentId?: number
  address?: string
  minWeight?: number
  since?: number
  until?: number
  limit?: number
}

interface RawEdge {
  source: string
  target: string
  kind: NetworkEdgeDto['kind']
  timestamp: number
  txHash: string
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toTimestampMs(value: unknown): number {
  const parsed = toFiniteNumber(value) ?? 0
  if (parsed > 0 && parsed < 1_000_000_000_000) {
    return parsed * 1000
  }
  return parsed
}

function toLowerAddress(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.toLowerCase()
}

function toAgentIdString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'string') return value
  return ''
}

function createAgentNodeId(chainId: number, agentId: string): string {
  return `agent:${chainId}:${agentId}`
}

function createAddressNodeId(address: string): string {
  return `address:${address.toLowerCase()}`
}

function ensureNode(nodeMap: Map<string, NetworkNodeDto>, nodeId: string): void {
  if (nodeMap.has(nodeId)) return

  if (nodeId.startsWith('agent:')) {
    const parts = nodeId.split(':')
    const chainId = parts[1]
    const agentId = parts[2]
    nodeMap.set(nodeId, {
      id: nodeId,
      kind: 'agent',
      chainId: toFiniteNumber(chainId) ?? undefined,
      agentId,
      name: agentId ? `Agent ${agentId}` : nodeId,
    })
    return
  }

  if (nodeId.startsWith('address:')) {
    const address = nodeId.slice('address:'.length)
    nodeMap.set(nodeId, {
      id: nodeId,
      kind: 'address',
      address,
      name: address,
    })
    return
  }

  nodeMap.set(nodeId, {
    id: nodeId,
    kind: 'feedback',
    name: nodeId,
  })
}

function includeEdge(
  edge: RawEdge,
  agentNodeId: string | null,
  addressNodeId: string | null,
): boolean {
  if (agentNodeId && edge.source !== agentNodeId && edge.target !== agentNodeId) {
    return false
  }

  if (addressNodeId && edge.source !== addressNodeId && edge.target !== addressNodeId) {
    return false
  }

  return true
}

export async function buildNetworkGraph(options: BuildNetworkGraphOptions): Promise<NetworkGraphDto> {
  const minWeight = Math.max(1, Math.floor(options.minWeight ?? 1))
  const sinceMs = options.since ? toTimestampMs(options.since) : undefined
  const untilMs = options.until ? toTimestampMs(options.until) : undefined
  const fetchLimit = Math.max(1, Math.min(10_000, options.limit ?? 1_000))

  const timestampFilter: Record<string, number> = {}
  if (sinceMs !== undefined) timestampFilter.$gte = sinceMs
  if (untilMs !== undefined) timestampFilter.$lte = untilMs

  const baseFilter: Document = { chainId: options.chainId }
  if (Object.keys(timestampFilter).length > 0) {
    baseFilter.timestamp = timestampFilter
  }

  const [reviewDb, registrantDb, agentReviewDb, responseDb] = await Promise.all([
    getReviewEdgeClient(),
    getRegistrantEdgeClient(),
    getAgentReviewEdgeClient(),
    getResponseEdgeClient(),
  ])

  const [reviewEdges, registrantEdges, agentReviewEdges, responseEdges] = await Promise.all([
    reviewDb.find(baseFilter, { timestamp: -1 }, fetchLimit),
    registrantDb.find(baseFilter, { timestamp: -1 }, fetchLimit),
    agentReviewDb.find(baseFilter, { timestamp: -1 }, fetchLimit),
    responseDb.find(baseFilter, { timestamp: -1 }, fetchLimit),
  ])

  const rawEdges: RawEdge[] = []

  for (const edge of reviewEdges) {
    const targetAgentId = toAgentIdString(edge.targetAgentId)
    const sourceAddress = toLowerAddress(edge.clientAddress)
    if (!targetAgentId || !sourceAddress) continue

    rawEdges.push({
      source: createAddressNodeId(sourceAddress),
      target: createAgentNodeId(options.chainId, targetAgentId),
      kind: 'review',
      timestamp: toTimestampMs(edge.timestamp),
      txHash: edge.txHash,
    })
  }

  for (const edge of registrantEdges) {
    const targetAgentId = toAgentIdString(edge.sourceAgentId)
    const sourceAddress = toLowerAddress(edge.ownerAddress)
    if (!targetAgentId || !sourceAddress) continue

    rawEdges.push({
      source: createAddressNodeId(sourceAddress),
      target: createAgentNodeId(options.chainId, targetAgentId),
      kind: 'registrant',
      timestamp: toTimestampMs(edge.timestamp),
      txHash: edge.txHash,
    })
  }

  for (const edge of agentReviewEdges) {
    const sourceAgentId = toAgentIdString(edge.sourceAgentId)
    const targetAgentId = toAgentIdString(edge.targetAgentId)
    if (!sourceAgentId || !targetAgentId) continue

    rawEdges.push({
      source: createAgentNodeId(options.chainId, sourceAgentId),
      target: createAgentNodeId(options.chainId, targetAgentId),
      kind: 'agent-review',
      timestamp: toTimestampMs(edge.timestamp),
      txHash: edge.txHash,
    })
  }

  for (const edge of responseEdges) {
    const targetAgentId = toAgentIdString(edge.targetAgentId)
    const sourceAddress = toLowerAddress(edge.responder)
    if (!targetAgentId || !sourceAddress) continue

    rawEdges.push({
      source: createAddressNodeId(sourceAddress),
      target: createAgentNodeId(options.chainId, targetAgentId),
      kind: 'response',
      timestamp: toTimestampMs(edge.timestamp),
      txHash: edge.txHash,
    })
  }

  const agentNodeId = options.agentId !== undefined
    ? createAgentNodeId(options.chainId, String(options.agentId))
    : null
  const addressNodeId = options.address
    ? createAddressNodeId(options.address)
    : null

  const aggregateMap = new Map<string, NetworkEdgeDto>()

  for (const edge of rawEdges) {
    if (!includeEdge(edge, agentNodeId, addressNodeId)) continue

    const key = `${edge.kind}:${edge.source}:${edge.target}`
    const existing = aggregateMap.get(key)

    if (!existing) {
      aggregateMap.set(key, {
        id: key,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        weight: 1,
        firstSeen: edge.timestamp,
        lastSeen: edge.timestamp,
        txHash: edge.txHash,
      })
      continue
    }

    existing.weight = (existing.weight ?? 0) + 1
    if (existing.firstSeen === undefined || edge.timestamp < existing.firstSeen) {
      existing.firstSeen = edge.timestamp
    }
    if (existing.lastSeen === undefined || edge.timestamp > existing.lastSeen) {
      existing.lastSeen = edge.timestamp
      existing.txHash = edge.txHash
    }
  }

  const rankedEdges = Array.from(aggregateMap.values())
    .filter((edge) => (edge.weight ?? 0) >= minWeight)
    .sort((a, b) => {
      const byWeight = (b.weight ?? 0) - (a.weight ?? 0)
      if (byWeight !== 0) return byWeight
      return (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
    })

  const truncated = rankedEdges.length > fetchLimit
  const edges = rankedEdges.slice(0, fetchLimit)

  const nodeMap = new Map<string, NetworkNodeDto>()
  for (const edge of edges) {
    ensureNode(nodeMap, edge.source)
    ensureNode(nodeMap, edge.target)
  }

  const nodes = Array.from(nodeMap.values())

  const agentReviewEdgesOnly = edges.filter((edge) => edge.kind === 'agent-review')
  const edgeKeySet = new Set(agentReviewEdgesOnly.map((edge) => `${edge.source}->${edge.target}`))

  let reciprocalCount = 0
  for (const edge of agentReviewEdgesOnly) {
    if (edgeKeySet.has(`${edge.target}->${edge.source}`)) {
      reciprocalCount += 1
    }
  }

  const reciprocalReviewRatioGlobal = agentReviewEdgesOnly.length > 0
    ? reciprocalCount / agentReviewEdgesOnly.length
    : null

  const addressToAgentLinks = new Map<string, Set<string>>()
  for (const edge of edges) {
    const sourceIsAddress = edge.source.startsWith('address:')
    const targetIsAddress = edge.target.startsWith('address:')
    const sourceIsAgent = edge.source.startsWith('agent:')
    const targetIsAgent = edge.target.startsWith('agent:')

    if (sourceIsAddress && targetIsAgent) {
      const set = addressToAgentLinks.get(edge.source) ?? new Set<string>()
      set.add(edge.target)
      addressToAgentLinks.set(edge.source, set)
    }

    if (targetIsAddress && sourceIsAgent) {
      const set = addressToAgentLinks.get(edge.target) ?? new Set<string>()
      set.add(edge.source)
      addressToAgentLinks.set(edge.target, set)
    }
  }

  let networkBridgeCount = 0
  for (const linkedAgents of addressToAgentLinks.values()) {
    if (linkedAgents.size > 1) networkBridgeCount += 1
  }

  return {
    nodes,
    edges,
    metrics: {
      reciprocalReviewRatioGlobal,
      isolatedClusterShare: null,
      networkBridgeCount,
    },
    meta: {
      edgeLimitApplied: fetchLimit,
      truncated,
    },
  }
}
