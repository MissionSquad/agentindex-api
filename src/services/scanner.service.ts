import { EvmDecoder } from 'evmdecoder'
import type { DeepPartial, Config } from 'evmdecoder/lib/config'
import type {
  RawBlock,
  RawTransactionResponse,
} from 'evmdecoder/lib/eth/responses'
import { log } from '../utils/logger'
import { TRACKED_ADDRESSES, TRACKED_SELECTORS } from '../config/erc8004'
import {
  mapTransactionFact,
  mapCallFact,
  mapEventFacts,
  deriveGraphEdges,
} from './mapper.service'
import { upsertTransactionBatch } from '../repositories/transaction.repository'
import { upsertEventBatch } from '../repositories/event.repository'
import { upsertGraphEdgeBatch } from '../repositories/graph.repository'
import { upsertChainSyncState } from '../repositories/chain-state.repository'
import { resolveAgentMetadataFromEvents } from './agent-metadata.service'
import {
  isPersistableDecodedTransaction,
  isFormattedTransactionResponse,
} from '../types/evm'
import type { TransactionFact, CallFact, EventFact } from '../types/mongo'

interface ScannerOptions {
  chainId: number
  network: string
  rpcUrl: string
  abiDirectory?: string
  txConcurrency?: number
  onEventFactsPersisted?: (eventFacts: EventFact[]) => void
}

interface CandidateProcessResult {
  txFact: TransactionFact
  callFact: CallFact | null
  eventFacts: EventFact[]
}

interface ProcessBlockOptions {
  awaitMetadataResolution?: boolean
}

export class ScannerService {
  private decoder: EvmDecoder | null = null
  private readonly chainId: number
  private readonly network: string
  private readonly rpcUrl: string
  private readonly abiDirectory: string | undefined
  private readonly txConcurrency: number
  private readonly onEventFactsPersisted?: (eventFacts: EventFact[]) => void
  private readonly inFlightTx = new Map<string, Promise<void>>()

  constructor(opts: ScannerOptions) {
    this.chainId = opts.chainId
    this.network = opts.network
    this.rpcUrl = opts.rpcUrl
    this.abiDirectory = opts.abiDirectory
    this.txConcurrency = Math.max(1, opts.txConcurrency ?? 8)
    this.onEventFactsPersisted = opts.onEventFactsPersisted
  }

  async initialize(): Promise<void> {
    const config: DeepPartial<Config> = {
      eth: {
        url: this.rpcUrl,
      },
      abi: {
        decodeAnonymous: true,
        fingerprintContracts: true,
        requireContractMatch: false,
        reconcileStructShapeFromTuples: true,
        ...(this.abiDirectory ? { directory: this.abiDirectory, searchRecursive: true } : {}),
      },
    }

    this.decoder = new EvmDecoder(config)
    await this.decoder.initialize()
    log({ level: 'info', msg: 'EvmDecoder initialized' })
  }

  getDecoder(): EvmDecoder {
    if (!this.decoder) {
      throw new Error('ScannerService not initialized. Call initialize() first.')
    }
    return this.decoder
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.getDecoder().getLatestBlockNumber()
  }

  /**
   * Process a single block: filter candidates, decode, persist.
   * Returns true if any ERC-8004 transactions were found.
   */
  async processBlock(blockNumber: number, options?: ProcessBlockOptions): Promise<boolean> {
    const decoder = this.getDecoder()

    // Step 1: Get raw block for lightweight candidate filtering
    const rawBlock: RawBlock = await decoder.getBlock(blockNumber, false)
    const blockHash = rawBlock.hash ?? ''

    // Step 2: Filter candidate transactions
    const candidates = (rawBlock.transactions ?? []).filter((tx: RawTransactionResponse) => {
      if (!tx.to) return false
      const selector = tx.input?.slice(0, 10) ?? ''
      if (TRACKED_SELECTORS.has(selector)) return true

      const toAddr = tx.to.toLowerCase()
      return TRACKED_ADDRESSES.has(toAddr)
    })

    if (candidates.length === 0) {
      // Still update sync state even with no candidates
      await this.updateSyncState(blockNumber, blockHash)
      return false
    }

    // Step 3: Fetch full decoded transactions for each candidate with bounded concurrency
    const candidateResults = await this.mapWithConcurrency(
      candidates,
      this.txConcurrency,
      async (candidate): Promise<CandidateProcessResult | null> => {
        try {
          const candidateHash = candidate.hash.toLowerCase()
          if (this.inFlightTx.has(candidateHash)) {
            return null
          }

          const decodedResult = await decoder.getTransaction(candidate.hash, true)
          if (!isPersistableDecodedTransaction(decodedResult)) {
            if (!isFormattedTransactionResponse(decodedResult)) {
              log({
                level: 'warn',
                msg: `Skipping candidate tx ${candidate.hash}: decoder returned raw transaction`,
              })
              return null
            }
            return null
          }

          const eventFacts = mapEventFacts(this.chainId, decodedResult)
          if (
            eventFacts.length === 0
            && !TRACKED_ADDRESSES.has(decodedResult.transaction.to.toLowerCase())
          ) {
            return null
          }

          return {
            txFact: mapTransactionFact(this.chainId, decodedResult),
            callFact: mapCallFact(this.chainId, decodedResult),
            eventFacts,
          }
        } catch (txErr) {
          log({ level: 'error', msg: `Failed to process candidate tx ${candidate.hash}`, error: txErr })
          return null
        }
      },
    )

    const allTxFacts: TransactionFact[] = []
    const allCallFacts: CallFact[] = []
    const allEventFacts: EventFact[] = []
    for (const result of candidateResults) {
      if (!result) continue
      allTxFacts.push(result.txFact)
      if (result.callFact) allCallFacts.push(result.callFact)
      allEventFacts.push(...result.eventFacts)
    }

    // Step 4: Persist all documents with idempotent upserts
    await upsertTransactionBatch(allTxFacts, allCallFacts)
    await upsertEventBatch(allEventFacts)
    this.emitPersistedEvents(allEventFacts)
    const edges = await deriveGraphEdges(this.chainId, allEventFacts)
    await upsertGraphEdgeBatch(edges.reviews, edges.registrants, edges.agentReviews, edges.responses)

    const shouldAwaitMetadataResolution = options?.awaitMetadataResolution ?? false
    if (shouldAwaitMetadataResolution) {
      await resolveAgentMetadataFromEvents(this.chainId, allEventFacts)
    } else {
      void resolveAgentMetadataFromEvents(this.chainId, allEventFacts).catch((error) => {
        log({ level: 'error', msg: 'Background metadata resolution failed', error })
      })
    }

    // Step 5: Update sync checkpoint
    await this.updateSyncState(blockNumber, blockHash)

    log({
      level: 'info',
      msg: `Block ${blockNumber}: ${candidates.length} candidates, ${allTxFacts.length} txs, ${allEventFacts.length} events persisted`,
    })

    return allTxFacts.length > 0
  }

  /**
   * Process a transaction by hash (for real-time log notifications).
   * Does NOT advance the sync checkpoint.
   */
  async processTransaction(txHash: string): Promise<void> {
    const normalizedTxHash = txHash.toLowerCase()
    const inFlight = this.inFlightTx.get(normalizedTxHash)
    if (inFlight) {
      await inFlight
      return
    }

    const processingPromise = this.processTransactionInternal(normalizedTxHash)
      .finally(() => {
        this.inFlightTx.delete(normalizedTxHash)
      })

    this.inFlightTx.set(normalizedTxHash, processingPromise)
    await processingPromise
  }

  private async processTransactionInternal(txHash: string): Promise<void> {
    const decoder = this.getDecoder()

    try {
      const decodedResult = await decoder.getTransaction(txHash, true)

      if (!isPersistableDecodedTransaction(decodedResult)) {
        if (!isFormattedTransactionResponse(decodedResult)) {
          log({
            level: 'warn',
            msg: `Skipping tx ${txHash}: decoder returned raw transaction`,
          })
        }
        return
      }

      const txFact = mapTransactionFact(this.chainId, decodedResult)
      const callFact = mapCallFact(this.chainId, decodedResult)
      const eventFacts = mapEventFacts(this.chainId, decodedResult)

      await upsertTransactionBatch([txFact], callFact ? [callFact] : [])
      await upsertEventBatch(eventFacts)
      this.emitPersistedEvents(eventFacts)

      const edges = await deriveGraphEdges(this.chainId, eventFacts, txHash)
      await upsertGraphEdgeBatch(edges.reviews, edges.registrants, edges.agentReviews, edges.responses)
      await resolveAgentMetadataFromEvents(this.chainId, eventFacts)
    } catch (error) {
      log({ level: 'error', msg: `Failed to process transaction ${txHash}`, error })
    }
  }

  private async updateSyncState(blockNumber: number, blockHash: string): Promise<void> {
    await upsertChainSyncState({
      chainId: this.chainId,
      network: this.network,
      lastSyncedBlock: blockNumber,
      lastSyncedBlockHash: blockHash,
      updatedAt: Date.now(),
    })
  }

  private emitPersistedEvents(eventFacts: EventFact[]): void {
    if (eventFacts.length === 0 || !this.onEventFactsPersisted) return

    try {
      this.onEventFactsPersisted(eventFacts)
    } catch (error) {
      log({ level: 'error', msg: 'Scanner persisted-event callback failed', error })
    }
  }

  private async mapWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    mapper: (item: TInput) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    if (items.length === 0) {
      return []
    }

    const workerCount = Math.min(Math.max(1, concurrency), items.length)
    const results: TOutput[] = []
    let cursor = 0

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) {
          return
        }
        const item = items[index]
        const result = await mapper(item)
        results.push(result)
      }
    })

    await Promise.all(workers)
    return results
  }
}
