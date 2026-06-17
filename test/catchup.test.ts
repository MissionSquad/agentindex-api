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

vi.mock('../src/utils/retry', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

import { runCatchup, runCatchupWithRestart, fillGap } from '../src/services/catchup.service'
import { getChainSyncState } from '../src/repositories/chain-state.repository'
import { sleep } from '../src/utils/retry'

const mockGetChainSyncState = vi.mocked(getChainSyncState)
const mockSleep = vi.mocked(sleep)

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

describe('runCatchupWithRestart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const restartOptions = { baseDelayMs: 10, maxDelayMs: 100 }

  it('returns the latest block without restarting when catch-up succeeds', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 10,
      lastSyncedBlockHash: '0x',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(12)
    const result = await runCatchupWithRestart(scanner as any, 1, 10, restartOptions)

    expect(result).toBe(12)
    expect(scanner.processBlock).toHaveBeenCalledTimes(2)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('restarts after a crash and resumes from the persisted checkpoint', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 10,
      lastSyncedBlockHash: '0x',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(12)
    // First attempt: block 11 fails -> runCatchup rethrows.
    // Second attempt: resumes from the checkpoint and completes.
    scanner.processBlock.mockRejectedValueOnce(new Error('rpc timeout'))

    const result = await runCatchupWithRestart(scanner as any, 1, 10, restartOptions)

    expect(result).toBe(12)
    expect(mockSleep).toHaveBeenCalledTimes(1)
    expect(mockSleep).toHaveBeenCalledWith(10)
    // 1 failed (11) + 2 succeeded (11, 12) on the retry
    expect(scanner.processBlock).toHaveBeenCalledTimes(3)
    expect(scanner.getLatestBlockNumber).toHaveBeenCalledTimes(2)
  })

  it('grows the restart delay exponentially up to the ceiling', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 10,
      lastSyncedBlockHash: '0x',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(12)
    scanner.processBlock
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))

    const result = await runCatchupWithRestart(scanner as any, 1, 10, { baseDelayMs: 10, maxDelayMs: 25 })

    expect(result).toBe(12)
    // 10 -> 20 -> capped at 25
    expect(mockSleep.mock.calls.map((c) => c[0])).toEqual([10, 20, 25])
  })

  it('does not run when shouldStop is already true', async () => {
    const scanner = createMockScanner(12)
    const result = await runCatchupWithRestart(scanner as any, 1, 10, {
      ...restartOptions,
      shouldStop: () => true,
    })

    expect(result).toBeNull()
    expect(scanner.getLatestBlockNumber).not.toHaveBeenCalled()
    expect(scanner.processBlock).not.toHaveBeenCalled()
  })

  it('stops after a crash without restarting when shouldStop flips to true', async () => {
    mockGetChainSyncState.mockResolvedValue({
      chainId: 1,
      network: 'mainnet',
      lastSyncedBlock: 10,
      lastSyncedBlockHash: '0x',
      updatedAt: Date.now(),
    })

    const scanner = createMockScanner(12)
    scanner.processBlock.mockRejectedValue(new Error('boom'))

    const shouldStop = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const result = await runCatchupWithRestart(scanner as any, 1, 10, {
      ...restartOptions,
      shouldStop,
    })

    expect(result).toBeNull()
    expect(mockSleep).not.toHaveBeenCalled()
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
