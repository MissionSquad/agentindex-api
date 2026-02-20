import { log } from '../utils/logger'
import { env } from '../env'
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
      await scanner.processBlock(blockNum)
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
    await scanner.processBlock(blockNum)
  }

  log({ level: 'info', msg: `Gap fill complete: ${count} blocks` })
}
