import type { TransactionFact, CallFact } from '../types/mongo'
import type { MongoDBClient } from '../utils/mongodb'
import { MongoPoolManager } from '../utils/mongoPoolManager'

let txClient: MongoDBClient<TransactionFact> | null = null
let callClient: MongoDBClient<CallFact> | null = null

export async function getTxFactClient(): Promise<MongoDBClient<TransactionFact>> {
  if (txClient) return txClient
  txClient = await MongoPoolManager.getInstance().createClient<TransactionFact>(
    'transaction_fact',
    [
      { key: { chainId: 1, txHash: 1 }, name: 'idx_tx_chainId_txHash_unique', unique: true },
      { key: { chainId: 1, blockNumber: -1, transactionIndex: -1 }, name: 'idx_tx_block_order' },
      { key: { chainId: 1, registryAddress: 1, blockNumber: -1 }, name: 'idx_tx_registry_block' },
      { key: { chainId: 1, from: 1, blockNumber: -1 }, name: 'idx_tx_from_block' },
      { key: { chainId: 1, to: 1, blockNumber: -1 }, name: 'idx_tx_to_block' },
    ],
  )
  return txClient
}

export async function getCallFactClient(): Promise<MongoDBClient<CallFact>> {
  if (callClient) return callClient
  callClient = await MongoPoolManager.getInstance().createClient<CallFact>(
    'call_fact',
    [
      { key: { chainId: 1, txHash: 1 }, name: 'idx_call_chainId_txHash_unique', unique: true },
      { key: { chainId: 1, functionSignature: 1, txHash: 1 }, name: 'idx_call_sig_txHash' },
    ],
  )
  return callClient
}

export async function upsertTransactionFact(fact: TransactionFact): Promise<void> {
  const db = await getTxFactClient()
  await db.upsert(fact, { chainId: fact.chainId, txHash: fact.txHash } as Partial<TransactionFact>)
}

export async function upsertCallFact(fact: CallFact): Promise<void> {
  const db = await getCallFactClient()
  await db.upsert(fact, { chainId: fact.chainId, txHash: fact.txHash } as Partial<CallFact>)
}

export async function upsertTransactionBatch(txFacts: TransactionFact[], callFacts: CallFact[]): Promise<void> {
  if (txFacts.length > 0) {
    const db = await getTxFactClient()
    await db.upsertBulk(txFacts.map((f) => ({
      item: f,
      filter: { chainId: f.chainId, txHash: f.txHash } as Partial<TransactionFact>,
    })))
  }
  if (callFacts.length > 0) {
    const db = await getCallFactClient()
    await db.upsertBulk(callFacts.map((f) => ({
      item: f,
      filter: { chainId: f.chainId, txHash: f.txHash } as Partial<CallFact>,
    })))
  }
}

export async function deleteTransactionFactsByBlock(chainId: number, blockNumber: number): Promise<void> {
  const db = await getTxFactClient()
  await db.delete({ chainId, blockNumber } as Partial<TransactionFact>)
  const callDb = await getCallFactClient()
  // Call facts don't have blockNumber directly, so we find tx hashes first
  const txs = await db.find({ chainId, blockNumber } as Partial<TransactionFact>)
  if (txs.length > 0) {
    const hashes = txs.map((t) => t.txHash)
    for (const hash of hashes) {
      await callDb.delete({ chainId, txHash: hash } as Partial<CallFact>)
    }
  }
}
