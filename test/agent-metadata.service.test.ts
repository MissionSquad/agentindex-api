import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentMetadata } from '../src/types/mongo'

const {
  mockUpsertAgentMetadata,
  mockUpsertAgentMetadataRawSnapshot,
  mockGetAgentMetadataByAgent,
  mockGetAgentMetadataClient,
  mockFetchOffchainContent,
  mockParseRegistrationJson,
  mockMetadataDb,
} = vi.hoisted(() => {
  const mockUpsertAgentMetadata = vi.fn().mockResolvedValue(undefined)
  const mockUpsertAgentMetadataRawSnapshot = vi.fn().mockResolvedValue(undefined)
  const mockGetAgentMetadataByAgent = vi.fn().mockResolvedValue(null)
  const mockMetadataDb = {
    find: vi.fn().mockResolvedValue([]),
  }
  const mockGetAgentMetadataClient = vi.fn().mockResolvedValue(mockMetadataDb)
  const mockFetchOffchainContent = vi.fn().mockResolvedValue(null)
  const mockParseRegistrationJson = vi.fn().mockReturnValue(null)

  return {
    mockUpsertAgentMetadata,
    mockUpsertAgentMetadataRawSnapshot,
    mockGetAgentMetadataByAgent,
    mockGetAgentMetadataClient,
    mockFetchOffchainContent,
    mockParseRegistrationJson,
    mockMetadataDb,
  }
})

vi.mock('../src/repositories/agent-metadata.repository', () => ({
  upsertAgentMetadata: mockUpsertAgentMetadata,
  getAgentMetadataByAgent: mockGetAgentMetadataByAgent,
  getAgentMetadataClient: mockGetAgentMetadataClient,
}))

vi.mock('../src/repositories/agent-metadata-raw.repository', () => ({
  upsertAgentMetadataRawSnapshot: mockUpsertAgentMetadataRawSnapshot,
}))

vi.mock('../src/services/offchain-fetch.service', () => ({
  fetchOffchainContent: mockFetchOffchainContent,
  parseRegistrationJson: mockParseRegistrationJson,
}))

vi.mock('../src/utils/logger', () => ({
  log: vi.fn(),
}))

vi.mock('../src/env', () => ({
  env: {
    METADATA_FETCH_CONCURRENCY: 8,
    METADATA_IGNORED_URI_PREFIXES: ['https://ag0.xyz'],
  },
}))

import {
  computeUriHash,
  extractAgentMetadata,
  IGNORED_METADATA_URI_ERROR,
  isIgnoredMetadataUri,
  resolveAndPersistAgentMetadata,
  resolveAgentMetadataFromEvents,
  reResolveStaleMetadata,
  retryFailedResolutions,
} from '../src/services/agent-metadata.service'

describe('agent-metadata.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsertAgentMetadata.mockResolvedValue(undefined)
    mockUpsertAgentMetadataRawSnapshot.mockResolvedValue(undefined)
    mockGetAgentMetadataByAgent.mockResolvedValue(null)
    mockGetAgentMetadataClient.mockResolvedValue(mockMetadataDb)
    mockMetadataDb.find.mockResolvedValue([])
    mockFetchOffchainContent.mockResolvedValue(null)
    mockParseRegistrationJson.mockReturnValue(null)
  })

  it('computeUriHash is deterministic', () => {
    const uri = 'ipfs://QmAgent'
    const first = computeUriHash(uri)
    const second = computeUriHash(uri)
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('isIgnoredMetadataUri matches configured ignore prefixes', () => {
    expect(isIgnoredMetadataUri('https://ag0.xyz')).toBe(true)
    expect(isIgnoredMetadataUri('https://ag0.xyz/metadata.json')).toBe(true)
    expect(isIgnoredMetadataUri('https://example.com/metadata.json')).toBe(false)
  })

  it('extractAgentMetadata normalizes known variants', () => {
    const result = extractAgentMetadata({
      name: 'Agent',
      description: 'Description',
      type: 'assistant',
      image: 'ipfs://image',
      active: true,
      x402support: true,
      '8004Support': true,
      services: [
        'a2a',
        1,
        { name: 'MCP', endpoint: 'https://mcp.example.com', mcpTools: ['list_agents'] },
        { name: '  ' },
        { endpoint: 'https://example.com' },
        'A2A',
      ],
      registrations: [
        'eip155:1:0xregistry',
        { agentId: '42', agentRegistry: 'eip155:8453:0xregistry2' },
      ],
      supportedTrusts: ['trust-a'],
      supportedTrust: ['trust-a', 'trust-b'],
      attributes: {
        protocols: ['morpho'],
        dataFeeds: ['dexscreener'],
        tags: ['defi'],
        blockchain: { chain: 'base', chainId: 8453 },
      },
      twitter: 'https://x.com/example',
      email: 'support@example.com',
    })

    expect(result).toMatchObject({
      name: 'Agent',
      description: 'Description',
      type: 'assistant',
      image: 'ipfs://image',
      active: true,
      x402Support: true,
      erc8004Support: true,
      services: ['a2a', 'MCP'],
      registrations: ['eip155:1:0xregistry', 'eip155:8453:0xregistry2'],
      supportedTrusts: ['trust-a', 'trust-b'],
      serviceEndpoints: ['https://mcp.example.com', 'https://example.com'],
      serviceMcpTools: ['list_agents'],
      registrationRegistries: ['eip155:1:0xregistry', 'eip155:8453:0xregistry2'],
      registrationAgentIds: [42],
      attributeProtocols: ['morpho'],
      attributeDataFeeds: ['dexscreener'],
      attributeTags: ['defi'],
      attributeBlockchains: ['base'],
      attributeChainIds: [8453],
      contactEmails: ['support@example.com'],
      contactTwitter: ['https://x.com/example'],
    })
    expect(result.searchTerms).toContain('mcp')
    expect(result.searchTerms).toContain('defi')
    expect(result.searchTerms).toContain('support@example.com')
  })

  it('resolveAndPersistAgentMetadata stores resolved metadata on success', async () => {
    mockFetchOffchainContent.mockResolvedValue(Buffer.from('{}', 'utf-8'))
    mockParseRegistrationJson.mockReturnValue({
      name: 'Resolved Agent',
      services: ['a2a'],
      x402Support: true,
    })

    const result = await resolveAndPersistAgentMetadata({
      chainId: 1,
      agentId: 7,
      uri: 'ipfs://QmResolved',
      eventTimestamp: 1000,
      eventTxHash: '0xtx',
      eventBlockNumber: 42,
    })

    expect(result.resolveStatus).toBe('resolved')
    expect(result.name).toBe('Resolved Agent')
    expect(result.services).toEqual(['a2a'])
    expect(mockUpsertAgentMetadata).toHaveBeenCalledTimes(1)
    expect(mockUpsertAgentMetadataRawSnapshot).toHaveBeenCalledTimes(1)
  })

  it('resolveAndPersistAgentMetadata stores failed state when fetch fails', async () => {
    mockFetchOffchainContent.mockResolvedValue(null)

    const result = await resolveAndPersistAgentMetadata({
      chainId: 1,
      agentId: 9,
      uri: 'https://example.com/agent.json',
      eventTimestamp: 1000,
      eventTxHash: '0xtx',
      eventBlockNumber: 44,
    })

    expect(result.resolveStatus).toBe('failed')
    expect(result.resolveError).toBe('Failed to fetch URI content')
    expect(mockUpsertAgentMetadata).toHaveBeenCalledTimes(1)
  })

  it('resolveAndPersistAgentMetadata marks ignored URIs as ignored policy failures', async () => {
    const result = await resolveAndPersistAgentMetadata({
      chainId: 1,
      agentId: 10,
      uri: 'https://ag0.xyz',
      eventTimestamp: 1000,
      eventTxHash: '0xtx',
      eventBlockNumber: 45,
    })

    expect(result.resolveStatus).toBe('failed')
    expect(result.resolveError).toBe(IGNORED_METADATA_URI_ERROR)
    expect(mockFetchOffchainContent).not.toHaveBeenCalled()
    expect(mockUpsertAgentMetadata).toHaveBeenCalledTimes(1)
  })

  it('resolveAndPersistAgentMetadata skips fetch when URI hash unchanged and already resolved', async () => {
    const existing: AgentMetadata = {
      id: '1:7',
      chainId: 1,
      agentId: 7,
      uri: 'ipfs://same',
      uriHash: computeUriHash('ipfs://same'),
      name: 'Existing',
      description: null,
      type: null,
      image: null,
      active: null,
      x402Support: null,
      erc8004Support: null,
      services: [],
      registrations: [],
      supportedTrusts: [],
      resolveStatus: 'resolved',
      resolveError: null,
      resolvedAt: 1000,
      eventTimestamp: 1000,
      eventTxHash: '0xold',
      eventBlockNumber: 1,
    }
    mockGetAgentMetadataByAgent.mockResolvedValue(existing)

    const result = await resolveAndPersistAgentMetadata({
      chainId: 1,
      agentId: 7,
      uri: 'ipfs://same',
      eventTimestamp: 2000,
      eventTxHash: '0xnew',
      eventBlockNumber: 2,
    })

    expect(result.resolveStatus).toBe('resolved')
    expect(result.eventTxHash).toBe('0xnew')
    expect(mockFetchOffchainContent).not.toHaveBeenCalled()
    expect(mockUpsertAgentMetadata).toHaveBeenCalledTimes(1)
  })

  it('resolveAndPersistAgentMetadata reprocesses unchanged URI when forced', async () => {
    const existing: AgentMetadata = {
      id: '1:8',
      chainId: 1,
      agentId: 8,
      uri: 'ipfs://same',
      uriHash: computeUriHash('ipfs://same'),
      name: 'Old Name',
      description: null,
      type: null,
      image: null,
      active: null,
      x402Support: null,
      erc8004Support: null,
      services: [],
      registrations: [],
      supportedTrusts: [],
      resolveStatus: 'resolved',
      resolveError: null,
      resolvedAt: 1000,
      eventTimestamp: 1000,
      eventTxHash: '0xold',
      eventBlockNumber: 1,
    }
    mockGetAgentMetadataByAgent.mockResolvedValue(existing)
    mockFetchOffchainContent.mockResolvedValue(Buffer.from('{}', 'utf-8'))
    mockParseRegistrationJson.mockReturnValue({
      name: 'Refreshed Name',
      services: ['mcp'],
    })

    const result = await resolveAndPersistAgentMetadata({
      chainId: 1,
      agentId: 8,
      uri: 'ipfs://same',
      eventTimestamp: 3000,
      eventTxHash: '0xnew',
      eventBlockNumber: 3,
      forceReprocess: true,
    })

    expect(mockFetchOffchainContent).toHaveBeenCalledTimes(1)
    expect(result.resolveStatus).toBe('resolved')
    expect(result.name).toBe('Refreshed Name')
    expect(result.services).toEqual(['mcp'])
  })

  it('resolveAgentMetadataFromEvents deduplicates latest URI event per agent', async () => {
    mockFetchOffchainContent.mockResolvedValue(Buffer.from('{}', 'utf-8'))
    mockParseRegistrationJson.mockReturnValue({ name: 'Latest' })

    await resolveAgentMetadataFromEvents(1, [
      {
        id: '1:tx1:1',
        chainId: 1,
        registryAddress: '0x1',
        txHash: '0xtx1',
        blockNumber: 100,
        timestamp: 100,
        logIndex: 1,
        topic0: '0x',
        topics: [],
        data: '0x',
        eventName: 'Registered',
        eventSignature: '',
        eventArgs: { agentId: 7, agentURI: 'ipfs://one' },
      },
      {
        id: '1:tx1:2',
        chainId: 1,
        registryAddress: '0x1',
        txHash: '0xtx1',
        blockNumber: 100,
        timestamp: 100,
        logIndex: 2,
        topic0: '0x',
        topics: [],
        data: '0x',
        eventName: 'URIUpdated',
        eventSignature: '',
        eventArgs: { agentId: 7, newURI: 'ipfs://two' },
      },
    ])

    expect(mockFetchOffchainContent).toHaveBeenCalledTimes(1)
    expect(mockFetchOffchainContent).toHaveBeenCalledWith('ipfs://two')
  })

  it('reResolveStaleMetadata re-resolves stale entries', async () => {
    mockMetadataDb.find.mockResolvedValue([
      {
        id: '1:11',
        chainId: 1,
        agentId: 11,
        uri: 'https://example.com/11.json',
        eventTimestamp: 1000,
        eventTxHash: '0x11',
        eventBlockNumber: 11,
      },
    ])
    mockFetchOffchainContent.mockResolvedValue(Buffer.from('{}', 'utf-8'))
    mockParseRegistrationJson.mockReturnValue({ name: 'Agent 11' })

    const count = await reResolveStaleMetadata(1, 1_000, 10)
    expect(count).toBe(1)
  })

  it('reResolveStaleMetadata skips ignored URIs', async () => {
    mockMetadataDb.find.mockResolvedValue([
      {
        id: '1:13',
        chainId: 1,
        agentId: 13,
        uri: 'https://ag0.xyz',
        eventTimestamp: 1000,
        eventTxHash: '0x13',
        eventBlockNumber: 13,
      },
    ])

    const count = await reResolveStaleMetadata(1, 1_000, 10)
    expect(count).toBe(0)
    expect(mockFetchOffchainContent).not.toHaveBeenCalled()
  })

  it('retryFailedResolutions retries failed entries', async () => {
    mockMetadataDb.find.mockResolvedValue([
      {
        id: '1:12',
        chainId: 1,
        agentId: 12,
        uri: 'https://example.com/12.json',
        eventTimestamp: 1000,
        eventTxHash: '0x12',
        eventBlockNumber: 12,
      },
    ])
    mockFetchOffchainContent.mockResolvedValue(Buffer.from('{}', 'utf-8'))
    mockParseRegistrationJson.mockReturnValue({ name: 'Agent 12' })

    const count = await retryFailedResolutions(1, 1_000, 10)
    expect(count).toBe(1)
  })

  it('retryFailedResolutions skips ignored URIs', async () => {
    mockMetadataDb.find.mockResolvedValue([
      {
        id: '1:14',
        chainId: 1,
        agentId: 14,
        uri: 'https://ag0.xyz',
        eventTimestamp: 1000,
        eventTxHash: '0x14',
        eventBlockNumber: 14,
      },
    ])

    const count = await retryFailedResolutions(1, 1_000, 10)
    expect(count).toBe(0)
    expect(mockFetchOffchainContent).not.toHaveBeenCalled()
  })
})
