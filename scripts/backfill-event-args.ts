/**
 * Backfills empty eventArgs on EventFact documents using existing
 * CallFact.rawArgs and TransactionFact.from already stored in MongoDB.
 * Does NOT re-fetch from the blockchain.
 *
 * Also re-derives graph edges (review_edge, registrant_edge, etc.) for
 * every patched EventFact so downstream queries work immediately.
 *
 * Usage:
 *   npx ts-node-dev --transpile-only scripts/backfill-event-args.ts [--dry-run] [--chain-id <id>]
 *
 * Reads .env for MongoDB connection settings.
 */

import { MongoPoolManager } from '../src/utils/mongoPoolManager'
import { getEventFactClient, upsertEventBatch } from '../src/repositories/event.repository'
import { getCallFactClient, getTxFactClient } from '../src/repositories/transaction.repository'
import { deriveGraphEdges } from '../src/services/mapper.service'
import { upsertGraphEdgeBatch } from '../src/repositories/graph.repository'
import { env } from '../src/env'
import type { EventFact, CallFact, TransactionFact } from '../src/types/mongo'
import type { Document } from 'mongodb'

// ---------------------------------------------------------------------------
// Constants — mirrors mapper.service.ts logic
// ---------------------------------------------------------------------------

const CALL_TO_PRIMARY_EVENT: Record<string, string> = {
  giveFeedback: 'NewFeedback',
  revokeFeedback: 'FeedbackRevoked',
  appendResponse: 'ResponseAppended',
  register: 'Registered',
}

const TARGET_EVENT_NAMES = Object.values(CALL_TO_PRIMARY_EVENT)
const BATCH_SIZE = 200

// ---------------------------------------------------------------------------
// Helpers — same extraction logic as mapper.service.ts
// ---------------------------------------------------------------------------

function extractFirstWord(data: string): number {
  if (!data || data === '0x' || data.length < 66) return 0
  const hex = data.startsWith('0x') ? data.slice(2, 66) : data.slice(0, 64)
  return Number(BigInt('0x' + hex))
}

function topicToNumber(topic: string | undefined): number {
  if (!topic) return 0
  return Number(BigInt(topic))
}

function buildArgsFromCall(
  eventName: string,
  callName: string,
  callArgs: Record<string, unknown>,
  txFrom: string,
  topics: string[],
  data: string,
): Record<string, unknown> | null {
  if (CALL_TO_PRIMARY_EVENT[callName] !== eventName) return null

  switch (eventName) {
    case 'NewFeedback':
      return {
        agentId: callArgs.agentId,
        clientAddress: txFrom,
        value: callArgs.value,
        valueDecimals: callArgs.valueDecimals,
        tag1: callArgs.tag1 ?? '',
        tag2: callArgs.tag2 ?? '',
        endpoint: callArgs.endpoint ?? '',
        feedbackURI: callArgs.feedbackURI ?? '',
        feedbackHash: callArgs.feedbackHash ?? '',
        feedbackIndex: extractFirstWord(data),
      }
    case 'FeedbackRevoked':
      return {
        agentId: callArgs.agentId,
        clientAddress: txFrom,
        feedbackIndex: callArgs.feedbackIndex,
      }
    case 'ResponseAppended':
      return {
        agentId: callArgs.agentId,
        clientAddress: callArgs.clientAddress,
        responder: txFrom,
        feedbackIndex: callArgs.feedbackIndex,
        responseURI: callArgs.responseURI ?? '',
        responseHash: callArgs.responseHash ?? '',
      }
    case 'Registered':
      return {
        agentId: topicToNumber(topics[1]),
        owner: txFrom,
        agentURI: callArgs.agentURI ?? '',
      }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { dryRun: boolean; chainId: number } {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const chainIdIdx = args.indexOf('--chain-id')
  const chainId =
    chainIdIdx !== -1 && args[chainIdIdx + 1]
      ? parseInt(args[chainIdIdx + 1], 10)
      : env.CHAIN_ID
  return { dryRun, chainId }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { dryRun, chainId } = parseArgs()

  console.log(`Backfill event args (chainId=${chainId}, dryRun=${dryRun})`)
  console.log(`Connecting to MongoDB at ${env.MONGO_HOST} / ${env.MONGO_DBNAME} ...`)

  MongoPoolManager.initialize({
    user: env.MONGO_USER,
    pass: env.MONGO_PASS,
    host: env.MONGO_HOST,
    db: env.MONGO_DBNAME,
    replicaSet: env.MONGO_REPLICASET,
  })

  const eventDb = await getEventFactClient()
  const callDb = await getCallFactClient()
  const txDb = await getTxFactClient()

  // Step 1: Find EventFacts with empty eventArgs for target event names
  const emptyEvents = await eventDb.aggregate<EventFact>([
    {
      $match: {
        chainId,
        eventName: { $in: TARGET_EVENT_NAMES },
        $expr: { $eq: [{ $objectToArray: '$eventArgs' }, []] },
      },
    },
    { $sort: { blockNumber: 1, logIndex: 1 } },
  ])

  console.log(`Found ${emptyEvents.length} EventFacts with empty eventArgs`)

  if (emptyEvents.length === 0) {
    console.log('Nothing to backfill.')
    await MongoPoolManager.getInstance().close()
    return
  }

  // Step 2: Collect unique txHashes and batch-fetch CallFacts + TransactionFacts
  const txHashes = Array.from(new Set(emptyEvents.map((e) => e.txHash)))
  console.log(`Spanning ${txHashes.length} unique transactions`)

  const callFactMap = new Map<string, CallFact>()
  const txFactMap = new Map<string, TransactionFact>()

  for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
    const batch = txHashes.slice(i, i + BATCH_SIZE)
    const [calls, txs] = await Promise.all([
      callDb.find({ chainId, txHash: { $in: batch } } as unknown as Document),
      txDb.find({ chainId, txHash: { $in: batch } } as unknown as Document),
    ])
    for (const c of calls) callFactMap.set(c.txHash, c)
    for (const t of txs) txFactMap.set(t.txHash, t)
    process.stdout.write(`\r  Loaded tx data: ${Math.min(i + BATCH_SIZE, txHashes.length)}/${txHashes.length}`)
  }
  console.log()

  console.log(`Loaded ${callFactMap.size} CallFacts, ${txFactMap.size} TransactionFacts`)

  // Step 3: Build supplemented EventFacts
  const updatedEvents: EventFact[] = []
  let skipped = 0

  for (const evt of emptyEvents) {
    const call = callFactMap.get(evt.txHash)
    const tx = txFactMap.get(evt.txHash)

    if (!call || !tx) {
      skipped++
      continue
    }

    const supplemented = buildArgsFromCall(
      evt.eventName,
      call.functionName,
      call.rawArgs,
      tx.from,
      evt.topics,
      evt.data,
    )

    if (!supplemented) {
      skipped++
      continue
    }

    updatedEvents.push({ ...evt, eventArgs: supplemented })
  }

  console.log(`Will backfill ${updatedEvents.length} events (skipped ${skipped})`)

  if (dryRun) {
    console.log('\n--- DRY RUN: Sample of first 5 updates ---')
    for (const evt of updatedEvents.slice(0, 5)) {
      console.log(`  ${evt.eventName} tx=${evt.txHash} logIndex=${evt.logIndex}`)
      console.log(`    eventArgs = ${JSON.stringify(evt.eventArgs)}`)
    }
    console.log('\nDry run complete. No database writes performed.')
    await MongoPoolManager.getInstance().close()
    return
  }

  // Step 4: Upsert updated EventFacts in batches
  for (let i = 0; i < updatedEvents.length; i += BATCH_SIZE) {
    const batch = updatedEvents.slice(i, i + BATCH_SIZE)
    await upsertEventBatch(batch)
    process.stdout.write(
      `\r  Updated events: ${Math.min(i + BATCH_SIZE, updatedEvents.length)}/${updatedEvents.length}`,
    )
  }
  console.log()

  // Step 5: Re-derive graph edges for all backfilled events
  console.log('Re-deriving graph edges ...')
  const { reviews, registrants, agentReviews, responses } = await deriveGraphEdges(
    chainId,
    updatedEvents,
  )
  await upsertGraphEdgeBatch(reviews, registrants, agentReviews, responses)
  console.log(
    `  Reviews: ${reviews.length}, Registrants: ${registrants.length}, ` +
      `AgentReviews: ${agentReviews.length}, Responses: ${responses.length}`,
  )

  console.log('\nBackfill complete.')
  await MongoPoolManager.getInstance().close()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
