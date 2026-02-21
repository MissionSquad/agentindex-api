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

/** agent_metadata_raw collection document */
export interface AgentMetadataRawSnapshot {
  /** Composite key: `${chainId}:${agentId}:${uriHash}` */
  id: string
  chainId: number
  agentId: number
  uri: string
  uriHash: string
  /** Parsed JSON payload when available */
  rawMetadata: Record<string, unknown> | null
  /** UTF-8 raw payload when parse fails */
  rawContent: string | null
  resolveStatus: 'resolved' | 'failed' | 'pending'
  resolveError: string | null
  resolvedAt: number
  eventTimestamp: number
  eventTxHash: string
  eventBlockNumber: number
}

/** agent_metadata collection document */
export interface AgentMetadata {
  /** Composite key: `${chainId}:${agentId}` */
  id: string
  chainId: number
  agentId: number
  /** Raw URI string (the current agent URI) */
  uri: string
  /** SHA-256 hex digest of the raw URI string, for fast change detection */
  uriHash: string
  /** Resolved metadata fields */
  name: string | null
  description: string | null
  type: string | null
  image: string | null
  active: boolean | null
  x402Support: boolean | null
  erc8004Support: boolean | null
  services: string[]
  registrations: string[]
  supportedTrusts: string[]
  /** Full parsed metadata JSON payload for reprocessing */
  rawMetadata?: Record<string, unknown> | null
  /** Preserved service objects from metadata.services */
  serviceEntries?: Record<string, unknown>[]
  /** Preserved registration objects from metadata.registrations */
  registrationEntries?: Record<string, unknown>[]
  /** Flattened service facets for indexed search/filter */
  serviceEndpoints?: string[]
  serviceVersions?: string[]
  serviceSkills?: string[]
  serviceDomains?: string[]
  serviceTools?: string[]
  serviceCapabilities?: string[]
  serviceA2aSkills?: string[]
  serviceMcpTools?: string[]
  /** Flattened registration facets for indexed search/filter */
  registrationRegistries?: string[]
  registrationAgentIds?: number[]
  /** Flattened metadata attributes for indexed search/filter */
  attributeProtocols?: string[]
  attributeDataFeeds?: string[]
  attributeTags?: string[]
  attributeBlockchains?: string[]
  attributeChainIds?: number[]
  /** Contact/search facets */
  contactEmails?: string[]
  contactTwitter?: string[]
  /** Lower-cased searchable terms, tokenized from metadata facets */
  searchTerms?: string[]
  /** Resolution status */
  resolveStatus: 'resolved' | 'failed' | 'pending'
  /** Error message if resolution failed */
  resolveError: string | null
  /** Timestamp (ms) when metadata was last resolved */
  resolvedAt: number
  /** Timestamp (ms) of the on-chain event that triggered this resolution */
  eventTimestamp: number
  /** Transaction hash of the event that set this URI */
  eventTxHash: string
  /** Block number of the event */
  eventBlockNumber: number
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
