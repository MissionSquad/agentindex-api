/**
 * Backfills eventArgs on MetadataSet EventFact documents.
 *
 * MetadataSet events have an indexed string parameter (indexedMetadataKey)
 * which evmdecoder cannot reconstruct from the keccak256 hash in topics.
 * This causes the ABI decode to fail during ingestion, leaving eventArgs empty.
 *
 * This script decodes the event data field directly (ABI-encoded string + bytes)
 * and reads agentId from topics[1] (always present as an indexed uint256).
 *
 * No blockchain RPC calls needed — all data is already in MongoDB.
 *
 * Usage:
 *   npx ts-node-dev --transpile-only scripts/backfill-metadata-events.ts [--dry-run] [--chain-id <id>]
 *
 * Reads .env for MongoDB connection settings.
 */

import { MongoPoolManager } from '../src/utils/mongoPoolManager'
import { getEventFactClient, upsertEventBatch } from '../src/repositories/event.repository'
import { env } from '../src/env'
import type { EventFact } from '../src/types/mongo'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 200

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topicToNumber(topic: string | undefined): number {
  if (!topic) return 0
  return Number(BigInt(topic))
}

/**
 * Decode ABI-encoded (string, bytes) from an event data field.
 * Pure hex parsing — no WASM dependency.
 */
function decodeAbiStringBytes(data: string): { metadataKey: string; metadataValue: string } {
  if (!data || data === '0x' || data.length <= 2) {
    return { metadataKey: '', metadataValue: '' }
  }
  const hex = data.startsWith('0x') ? data.slice(2) : data
  const readUint = (byteOffset: number): number =>
    parseInt(hex.slice(byteOffset * 2, byteOffset * 2 + 64), 16)

  const stringOffset = readUint(0)
  const bytesOffset = readUint(32)
  const stringLen = readUint(stringOffset)
  const stringHex = hex.slice((stringOffset + 32) * 2, (stringOffset + 32) * 2 + stringLen * 2)
  const metadataKey = Buffer.from(stringHex, 'hex').toString('utf-8')
  const bytesLen = readUint(bytesOffset)
  const bytesHex = hex.slice((bytesOffset + 32) * 2, (bytesOffset + 32) * 2 + bytesLen * 2)
  const metadataValue = '0x' + bytesHex
  return { metadataKey, metadataValue }
}

/**
 * Decode MetadataSet event from topics + data.
 * agentId comes from topics[1] (indexed uint256).
 * metadataKey and metadataValue come from ABI-decoding the data field.
 */
function decodeMetadataSetEvent(
  topics: string[],
  data: string,
): Record<string, unknown> | null {
  const agentId = topicToNumber(topics[1])
  if (agentId === 0) return null

  try {
    const { metadataKey, metadataValue } = decodeAbiStringBytes(data)
    return { agentId, metadataKey, metadataValue }
  } catch {
    return { agentId, metadataKey: '', metadataValue: '' }
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

  console.log(`Backfill MetadataSet events (chainId=${chainId}, dryRun=${dryRun})`)
  console.log(`Connecting to MongoDB at ${env.MONGO_HOST} / ${env.MONGO_DBNAME} ...`)

  MongoPoolManager.initialize({
    user: env.MONGO_USER,
    pass: env.MONGO_PASS,
    host: env.MONGO_HOST,
    db: env.MONGO_DBNAME,
    replicaSet: env.MONGO_REPLICASET,
  })

  const eventDb = await getEventFactClient()

  // Step 1: Find MetadataSet events missing agentId in eventArgs.
  const targetEvents = await eventDb.aggregate<EventFact>([
    {
      $match: {
        chainId,
        eventName: 'MetadataSet',
        $or: [
          { $expr: { $eq: [{ $objectToArray: '$eventArgs' }, []] } },
          { 'eventArgs.agentId': { $exists: false } },
        ],
      },
    },
    { $sort: { blockNumber: 1, logIndex: 1 } },
  ])

  console.log(`Found ${targetEvents.length} MetadataSet events to backfill`)

  if (targetEvents.length === 0) {
    console.log('Nothing to backfill.')
    await MongoPoolManager.getInstance().close()
    return
  }

  // Step 2: Decode eventArgs from topics + data.
  const updatedEvents: EventFact[] = []
  let skipped = 0
  let decodeErrors = 0

  for (const evt of targetEvents) {
    const supplemented = decodeMetadataSetEvent(evt.topics, evt.data)
    if (!supplemented) {
      skipped++
      continue
    }
    if (supplemented.metadataKey === '' && supplemented.metadataValue === '') {
      decodeErrors++
    }

    updatedEvents.push({ ...evt, eventArgs: supplemented })
  }

  console.log(`Will backfill ${updatedEvents.length} events (skipped ${skipped}, decode errors ${decodeErrors})`)

  if (dryRun) {
    console.log('\n--- DRY RUN: Sample of first 10 updates ---')
    for (const evt of updatedEvents.slice(0, 10)) {
      console.log(`  MetadataSet tx=${evt.txHash} logIndex=${evt.logIndex}`)
      console.log(`    eventArgs = ${JSON.stringify(evt.eventArgs)}`)
    }
    console.log('\nDry run complete. No database writes performed.')
    await MongoPoolManager.getInstance().close()
    return
  }

  // Step 3: Upsert updated EventFacts in batches
  for (let i = 0; i < updatedEvents.length; i += BATCH_SIZE) {
    const batch = updatedEvents.slice(i, i + BATCH_SIZE)
    await upsertEventBatch(batch)
    process.stdout.write(
      `\r  Updated events: ${Math.min(i + BATCH_SIZE, updatedEvents.length)}/${updatedEvents.length}`,
    )
  }
  console.log()

  console.log('\nBackfill complete.')
  await MongoPoolManager.getInstance().close()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
