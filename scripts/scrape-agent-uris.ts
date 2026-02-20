/**
 * Scrapes all agent URIs from MongoDB, resolves them, and streams the decoded
 * JSON payloads to an NDJSON file for analysis. Flushes to disk every 100
 * records to keep memory usage low.
 *
 * Usage:
 *   npx ts-node-dev --transpile-only scripts/scrape-agent-uris.ts [--out <path>]
 *
 * Reads .env for MongoDB connection settings. Output defaults to
 *   scripts/output/agent-uris.ndjson
 */

import { MongoPoolManager } from '../src/utils/mongoPoolManager'
import { getEventFactClient } from '../src/repositories/event.repository'
import { fetchOffchainContent, parseRegistrationJson } from '../src/services/offchain-fetch.service'
import { env } from '../src/env'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AggregatedUri {
  _id: unknown        // agentId (may be number, string, or bigint-string)
  uri: string         // latest URI from URIUpdated, or original from Registered
  source: string      // 'URIUpdated' or 'Registered'
}

interface ScrapedAgent {
  agentId: string
  uri: string
  source: string
  scheme: string
  resolved: boolean
  error: string | null
  json: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  return ''
}

function classifyScheme(uri: string): string {
  if (uri.startsWith('data:')) return 'data'
  if (uri.startsWith('ipfs://')) return 'ipfs'
  if (uri.startsWith('https://')) return 'https'
  if (uri.startsWith('http://')) return 'http'
  return 'unknown'
}

function parseArgs(): { outPath: string } {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const outPath = outIndex !== -1 && args[outIndex + 1]
    ? args[outIndex + 1]
    : path.join(__dirname, 'output', 'agent-uris.ndjson')
  return { outPath }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL = 100
const CONCURRENCY = 5

async function main(): Promise<void> {
  const { outPath } = parseArgs()

  console.log(`Connecting to MongoDB at ${env.MONGO_HOST} / ${env.MONGO_DBNAME} ...`)

  MongoPoolManager.initialize({
    user: env.MONGO_USER,
    pass: env.MONGO_PASS,
    host: env.MONGO_HOST,
    db: env.MONGO_DBNAME,
    replicaSet: env.MONGO_REPLICASET,
  })

  const eventDb = await getEventFactClient()
  const chainId = env.CHAIN_ID

  // ------------------------------------------------------------------
  // Step 1: Get latest URI per agent from URIUpdated events
  // ------------------------------------------------------------------
  console.log('Aggregating latest URIs from URIUpdated events ...')

  const uriUpdatedRows = await eventDb.aggregate<AggregatedUri>([
    { $match: { chainId, eventName: 'URIUpdated' } },
    {
      $project: {
        agentId: '$eventArgs.agentId',
        newURI: '$eventArgs.newURI',
        blockNumber: '$blockNumber',
        logIndex: '$logIndex',
      },
    },
    { $sort: { blockNumber: -1, logIndex: -1 } },
    {
      $group: {
        _id: '$agentId',
        uri: { $first: '$newURI' },
      },
    },
    { $addFields: { source: 'URIUpdated' } },
  ])

  const uriByAgent = new Map<string, { uri: string; source: string }>()
  for (const row of uriUpdatedRows) {
    uriByAgent.set(toStringValue(row._id), { uri: toStringValue(row.uri), source: row.source })
  }

  // ------------------------------------------------------------------
  // Step 2: Fill in agents that have no URIUpdated (use Registered URI)
  // ------------------------------------------------------------------
  console.log('Aggregating initial URIs from Registered events ...')

  const registeredRows = await eventDb.aggregate<AggregatedUri>([
    { $match: { chainId, eventName: 'Registered' } },
    {
      $project: {
        agentId: '$eventArgs.agentId',
        agentURI: '$eventArgs.agentURI',
        blockNumber: '$blockNumber',
        logIndex: '$logIndex',
      },
    },
    { $sort: { blockNumber: -1, logIndex: -1 } },
    {
      $group: {
        _id: '$agentId',
        uri: { $first: '$agentURI' },
      },
    },
    { $addFields: { source: 'Registered' } },
  ])

  for (const row of registeredRows) {
    const agentId = toStringValue(row._id)
    if (!uriByAgent.has(agentId)) {
      uriByAgent.set(agentId, { uri: toStringValue(row.uri), source: row.source })
    }
  }

  const totalAgents = uriByAgent.size
  console.log(`Found ${totalAgents} unique agents with URIs`)

  // ------------------------------------------------------------------
  // Step 3: Prepare output file
  // ------------------------------------------------------------------
  const outDir = path.dirname(outPath)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const stream = fs.createWriteStream(outPath, { encoding: 'utf-8' })

  // ------------------------------------------------------------------
  // Step 4: Resolve each URI, streaming to disk in batches
  // ------------------------------------------------------------------
  const schemeCounts = new Map<string, number>()
  const keyCounts = new Map<string, number>()
  let resolvedCount = 0
  let failedCount = 0
  let completed = 0
  let pendingWrites = 0

  const entries = Array.from(uriByAgent.entries())

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY)

    const batchResults = await Promise.allSettled(
      batch.map(async ([agentId, { uri, source }]): Promise<ScrapedAgent> => {
        const scheme = classifyScheme(uri)
        try {
          const content = await fetchOffchainContent(uri)
          if (!content) {
            return { agentId, uri, source, scheme, resolved: false, error: 'No content returned', json: null }
          }
          const json = parseRegistrationJson(content)
          if (!json) {
            return { agentId, uri, source, scheme, resolved: false, error: 'Failed to parse JSON', json: null }
          }
          return { agentId, uri, source, scheme, resolved: true, error: null, json }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          return { agentId, uri, source, scheme, resolved: false, error: message, json: null }
        }
      }),
    )

    for (const result of batchResults) {
      if (result.status !== 'fulfilled') continue

      const record = result.value

      // Track stats
      schemeCounts.set(record.scheme, (schemeCounts.get(record.scheme) ?? 0) + 1)
      if (record.resolved) {
        resolvedCount++
        if (record.json) {
          for (const key of Object.keys(record.json)) {
            keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
          }
        }
      } else {
        failedCount++
      }

      // Write immediately to stream
      stream.write(JSON.stringify(record) + '\n')
      pendingWrites++
    }

    completed += batch.length
    process.stdout.write(`\r  Resolved ${completed}/${totalAgents}`)

    // Flush to disk periodically by waiting for the stream to drain
    if (pendingWrites >= FLUSH_INTERVAL) {
      await new Promise<void>((resolve) => {
        if (stream.writableNeedDrain) {
          stream.once('drain', resolve)
        } else {
          resolve()
        }
      })
      pendingWrites = 0
    }
  }

  console.log() // newline after progress

  // Close stream and wait for it to finish
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve())
    stream.on('error', reject)
  })

  // ------------------------------------------------------------------
  // Step 5: Print summary
  // ------------------------------------------------------------------
  console.log('\n--- Summary ---')
  console.log(`Total agents:  ${resolvedCount + failedCount}`)
  console.log(`Resolved:      ${resolvedCount}`)
  console.log(`Failed:        ${failedCount}`)
  console.log('\nBy scheme:')
  for (const [scheme, count] of Array.from(schemeCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${scheme}: ${count}`)
  }
  console.log('\nJSON keys across all resolved payloads (key: count):')
  for (const [key, count] of Array.from(keyCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`)
  }
  console.log(`\nOutput written to: ${outPath}`)

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------
  await MongoPoolManager.getInstance().close()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
