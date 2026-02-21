import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('../src/utils/logger', () => ({
  log: vi.fn(),
}))

vi.mock('../src/env', () => ({
  env: { SCANNER_START_BLOCK: 24339870 },
}))

vi.mock('../src/repositories/chain-state.repository', () => ({
  getChainSyncState: vi.fn(),
}))

import { runCatchup, fillGap } from '../src/services/catchup.service'
import { getChainSyncState } from '../src/repositories/chain-state.repository'

const mockGetChainSyncState = vi.mocked(getChainSyncState)

function createMockScanner(latestBlock: number) {
  return {
    getLatestBlockNumber: vi.fn().mockResolvedValue(latestBlock),
    processBlock: vi.fn().mockResolvedValue(undefined),
  }
}

describe('runCatchup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes blocks from lastSyncedBlock+1 to latest', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 100,
      lastSyncedBlockHash: '0xabc',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(103)
    const result = await runCatchup(scanner as any, 1, 10)

    expect(result).toBe(103)
    expect(scanner.processBlock).toHaveBeenCalledTimes(3)
    expect(scanner.processBlock).toHaveBeenCalledWith(101, { awaitMetadataResolution: false })
    expect(scanner.processBlock).toHaveBeenCalledWith(102, { awaitMetadataResolution: false })
    expect(scanner.processBlock).toHaveBeenCalledWith(103, { awaitMetadataResolution: false })
  })

  it('starts from SCANNER_START_BLOCK when no sync state exists', async () => {
    mockGetChainSyncState.mockResolvedValue(null)

    const scanner = createMockScanner(24339872)
    const result = await runCatchup(scanner as any, 1, 10)

    expect(result).toBe(24339872)
    expect(scanner.processBlock).toHaveBeenCalledTimes(3)
    expect(scanner.processBlock).toHaveBeenCalledWith(24339870, { awaitMetadataResolution: false })
    expect(scanner.processBlock).toHaveBeenCalledWith(24339871, { awaitMetadataResolution: false })
    expect(scanner.processBlock).toHaveBeenCalledWith(24339872, { awaitMetadataResolution: false })
  })

  it('returns immediately when already at latest block', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 500,
      lastSyncedBlockHash: '0xdef',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(499)
    const result = await runCatchup(scanner as any, 1, 10)

    expect(result).toBe(499)
    expect(scanner.processBlock).not.toHaveBeenCalled()
  })

  it('rethrows when processBlock fails', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 10,
      lastSyncedBlockHash: '0x',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(12)
    scanner.processBlock.mockRejectedValueOnce(new Error('decode error'))

    await expect(runCatchup(scanner as any, 1, 10)).rejects.toThrow('decode error')
  })
})

describe('fillGap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes blocks in ascending order from fromBlock to toBlock', async () => {
    const scanner = createMockScanner(100)

    await fillGap(scanner as any, 1, 50, 52)

    expect(scanner.processBlock).toHaveBeenCalledTimes(3)
    expect(scanner.processBlock).toHaveBeenCalledWith(50, { awaitMetadataResolution: false })
    expect(scanner.processBlock).toHaveBeenCalledWith(51, { awaitMetadataResolution: false })
    expect(scanner.processBlock).toHaveBeenCalledWith(52, { awaitMetadataResolution: false })
  })

  it('returns immediately when fromBlock > toBlock', async () => {
    const scanner = createMockScanner(100)

    await fillGap(scanner as any, 1, 100, 50)

    expect(scanner.processBlock).not.toHaveBeenCalled()
  })

  it('processes single block when fromBlock equals toBlock', async () => {
    const scanner = createMockScanner(100)

    await fillGap(scanner as any, 1, 75, 75)

    expect(scanner.processBlock).toHaveBeenCalledTimes(1)
    expect(scanner.processBlock).toHaveBeenCalledWith(75, { awaitMetadataResolution: false })
  })
})
