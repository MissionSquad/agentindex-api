/** chain_sync_state collection document */
export interface ChainSyncState {
  chainId: number
  network: string
  lastSyncedBlock: number
  lastSyncedBlockHash: string
  updatedAt: number
}

/** transaction_fact collection document */
export interface TransactionFact {
  id: string // `${chainId}:${txHashLower}`
  chainId: number
  registryAddress: string
  txHash: string
  blockNumber: number
  blockHash: string
  transactionIndex: number
  timestamp: number
  status: 'success'
  from: string
  to: string
  nonce: number
  value: string | number
  gas: string | number
  gasUsed: string | number
  gasPrice: string | number
  maxFeePerGas: string | number | null
  maxPriorityFeePerGas: string | number | null
  cumulativeGasUsed: string | number
}

/** call_fact collection document */
export interface CallFact {
  id: string // `${chainId}:${txHashLower}`
  chainId: number
  txHash: string
  functionName: string
  functionSignature: string
  rawArgs: Record<string, unknown>
  normalizedArgs: Record<string, unknown>
}

/** event_fact collection document */
export interface EventFact {
  id: string // `${chainId}:${txHashLower}:${logIndex}`
  chainId: number
  registryAddress: string
  txHash: string
  blockNumber: number
  timestamp: number
  logIndex: number
  topic0: string
  topics: string[]
  data: string
  eventName: string
  eventSignature: string
  eventArgs: Record<string, unknown>
}

/** review_edge materialized graph document */
export interface ReviewEdge {
  feedbackId: string
  clientAddress: string
  targetAgentId: number
  score: number
  tag1: string
  tag2: string
  timestamp: number
  txHash: string
  chainId: number
}

/** registrant_edge materialized graph document */
export interface RegistrantEdge {
  ownerAddress: string
  sourceAgentId: number
  timestamp: number
  txHash: string
  chainId: number
}

/** agent_review_edge materialized graph document */
export interface AgentReviewEdge {
  sourceAgentId: number
  targetAgentId: number
  feedbackId: string
  viaAddress: string
  timestamp: number
  txHash: string
  chainId: number
}

/** response_edge materialized graph document */
export interface ResponseEdge {
  feedbackId: string
  responder: string
  targetAgentId: number
  timestamp: number
  txHash: string
  chainId: number
  logIndex: number
}

/** graph_component_snapshot materialized graph document */
export interface GraphComponentSnapshot {
  componentId: number
  nodeCount: number
  edgeCount: number
  externalEdgeCount: number
  snapshotDate: string
}
