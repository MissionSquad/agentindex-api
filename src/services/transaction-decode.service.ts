import type { EvmDecoder } from 'evmdecoder'
import { LruCache } from '../utils/lru-cache'
import { mapTransactionFact, mapCallFact, mapEventFacts } from './mapper.service'
import { isFormattedTransactionResponse } from '../types/evm'
import type { TransactionFact, CallFact, EventFact } from '../types/mongo'
import { log } from '../utils/logger'

export interface DecodedTransactionResult {
  transactionFact: TransactionFact
  callFact: CallFact | { functionName: string; functionSignature: string; rawArgs: Record<string, unknown>; normalizedArgs: Record<string, unknown> }
  eventFacts: EventFact[]
}

const DEFAULT_CACHE_SIZE = 1000
const DECODE_TIMEOUT_MS = 15_000

export class TransactionDecodeService {
  private readonly cache: LruCache<string, DecodedTransactionResult>

  constructor(cacheSize: number = DEFAULT_CACHE_SIZE) {
    this.cache = new LruCache<string, DecodedTransactionResult>(cacheSize)
  }

  async decode(
    decoder: EvmDecoder,
    chainId: number,
    txHash: string,
  ): Promise<DecodedTransactionResult | null> {
    const normalizedHash = txHash.toLowerCase()

    const cached = this.cache.get(normalizedHash)
    if (cached) {
      return cached
    }

    try {
      const decodedResult = await Promise.race([
        decoder.getTransaction(normalizedHash, true),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RPC decode timeout')), DECODE_TIMEOUT_MS),
        ),
      ])

      if (!isFormattedTransactionResponse(decodedResult)) {
        log({ level: 'warn', msg: `Real-time decode: tx ${normalizedHash} returned unparseable result` })
        return null
      }

      const txFact = mapTransactionFact(chainId, decodedResult)
      const callFact = mapCallFact(chainId, decodedResult) ?? {
        functionName: '',
        functionSignature: '',
        rawArgs: {},
        normalizedArgs: {},
      }
      const eventFacts = mapEventFacts(chainId, decodedResult)

      const result: DecodedTransactionResult = {
        transactionFact: txFact,
        callFact,
        eventFacts,
      }

      this.cache.set(normalizedHash, result)
      return result
    } catch (error) {
      log({ level: 'error', msg: `Real-time decode failed for tx ${normalizedHash}`, error })
      return null
    }
  }
}
