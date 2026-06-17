import { log } from '../utils/logger'
import { env } from '../env'
import { sleep } from '../utils/retry'
import { getChainSyncState } from '../repositories/chain-state.repository'
import type { ScannerService } from './scanner.service'

/**
 * Catch-up from lastSyncedBlock+1 to the latest chain height.
 * Processes blocks sequentially in ascending order.
 */
export async function runCatchup(
  scanner: ScannerService,
  chainId: number,
  batchSize: number,
): Promise<number> {
  const syncState = await getChainSyncState(chainId)
  const startBlock = syncState ? syncState.lastSyncedBlock + 1 : env.SCANNER_START_BLOCK
  const latestBlock = await scanner.getLatestBlockNumber()

  if (startBlock > latestBlock) {
    log({ level: 'info', msg: `Catch-up: already at latest block ${latestBlock}` })
    return latestBlock
  }

  const totalBlocks = latestBlock - startBlock + 1
  log({
    level: 'info',
    msg: `Catch-up: processing blocks ${startBlock} to ${latestBlock} (${totalBlocks} blocks)`,
  })

  let processed = 0
  for (let blockNum = startBlock; blockNum <= latestBlock; blockNum++) {
    try {
      await scanner.processBlock(blockNum, { awaitMetadataResolution: false })
      processed++

      if (processed % batchSize === 0 || blockNum === latestBlock) {
        log({
          level: 'info',
          msg: `Catch-up progress: ${processed}/${totalBlocks} blocks (current: ${blockNum})`,
        })
      }
    } catch (error) {
      log({ level: 'error', msg: `Catch-up failed at block ${blockNum}`, error })
      throw error
    }
  }

  log({ level: 'info', msg: `Catch-up complete: ${processed} blocks processed` })
  return latestBlock
}

export interface CatchupRestartOptions {
  /** Initial delay before the first restart attempt. */
  baseDelayMs: number
  /** Maximum delay between restart attempts (exponential backoff ceiling). */
  maxDelayMs: number
  /** Returns true when sync should stop scheduling further restarts (e.g. shutdown). */
  shouldStop?: () => boolean
}

/**
 * Run catch-up, automatically restarting it after a crash with exponential
 * backoff. Catch-up progress is checkpointed per block, so each restart resumes
 * from the last synced block — no work is lost or repeated. Without this, a
 * single failed block would abort sync permanently.
 *
 * Resolves with the latest block reached once catch-up completes, or null if it
 * stopped (via shouldStop) before completing.
 */
export async function runCatchupWithRestart(
  scanner: ScannerService,
  chainId: number,
  batchSize: number,
  options: CatchupRestartOptions,
): Promise<number | null> {
  const shouldStop = options.shouldStop ?? (() => false)
  let restartDelayMs = options.baseDelayMs

  while (!shouldStop()) {
    try {
      log({ level: 'info', msg: 'Starting catch-up sync...' })
      const latestBlock = await runCatchup(scanner, chainId, batchSize)
      log({ level: 'info', msg: `Catch-up complete. Latest block: ${latestBlock}` })
      return latestBlock
    } catch (error) {
      if (shouldStop()) return null
      log({
        level: 'error',
        msg: `Catch-up sync crashed; restarting in ${restartDelayMs}ms (resumes from last synced block)`,
        error,
      })
      await sleep(restartDelayMs)
      restartDelayMs = Math.min(restartDelayMs * 2, options.maxDelayMs)
    }
  }

  return null
}

/**
 * Fill gap blocks between lastSyncedBlock and a target block.
 */
export async function fillGap(
  scanner: ScannerService,
  chainId: number,
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  if (fromBlock > toBlock) return

  const count = toBlock - fromBlock + 1
  log({
    level: 'info',
    msg: `Filling gap: blocks ${fromBlock} to ${toBlock} (${count} blocks)`,
  })

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
    await scanner.processBlock(blockNum, { awaitMetadataResolution: false })
  }

  log({ level: 'info', msg: `Gap fill complete: ${count} blocks` })
}
