import type { DashboardActivityItem } from '../types/api'
import { getAgentMetadataBatch } from '../repositories/agent-metadata.repository'
import { log } from '../utils/logger'
import type { EventFact, AgentMetadata } from '../types/mongo'

function toSummaryValue(value: unknown, fallback: string): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim()
    if (normalized.length > 0) {
      return normalized
    }
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function resolveAgentId(eventArgs: Record<string, unknown>): string | null {
  const candidateAgentId = eventArgs['agentId'] ?? eventArgs['tokenId']
  if (typeof candidateAgentId === 'string' || typeof candidateAgentId === 'number') {
    return String(candidateAgentId)
  }
  return null
}

function parseAgentIdNumber(agentId: string | null): number | null {
  if (agentId === null) return null
  const normalized = agentId.trim()
  if (!/^\d+$/.test(normalized)) return null

  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

function metadataLookupKey(chainId: number, agentId: number): string {
  return `${chainId}:${agentId}`
}

async function buildMetadataLookup(
  items: DashboardActivityItem[],
): Promise<Map<string, AgentMetadata>> {
  const agentIdsByChain = new Map<number, Set<number>>()

  for (const item of items) {
    const parsedAgentId = parseAgentIdNumber(item.agentId)
    if (parsedAgentId === null) continue

    let chainIds = agentIdsByChain.get(item.chainId)
    if (!chainIds) {
      chainIds = new Set<number>()
      agentIdsByChain.set(item.chainId, chainIds)
    }

    chainIds.add(parsedAgentId)
  }

  const metadataLookup = new Map<string, AgentMetadata>()
  await Promise.all(
    Array.from(agentIdsByChain.entries()).map(async ([chainId, agentIds]) => {
      try {
        const rows = await getAgentMetadataBatch(chainId, Array.from(agentIds))
        for (const row of rows) {
          metadataLookup.set(metadataLookupKey(chainId, row.agentId), row)
        }
      } catch (error) {
        log({
          level: 'warn',
          msg: `Failed to enrich dashboard activity metadata for chain ${chainId}`,
          error,
        })
      }
    }),
  )

  return metadataLookup
}

export function toTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value < 1_000_000_000_000) {
      return value * 1000
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      if (parsed > 0 && parsed < 1_000_000_000_000) {
        return parsed * 1000
      }
      return parsed
    }
  }

  return 0
}

export function buildEventSummary(eventName: string, eventArgs: Record<string, unknown>): string {
  if (eventName === 'Registered') {
    return `Registered by ${toSummaryValue(eventArgs['owner'], 'unknown')}`
  }

  if (eventName === 'NewFeedback') {
    return `Feedback from ${toSummaryValue(eventArgs['clientAddress'], 'unknown')}`
  }

  if (eventName === 'ResponseAppended') {
    return `Response by ${toSummaryValue(eventArgs['responder'], 'unknown')}`
  }

  if (eventName === 'FeedbackRevoked') {
    return `Feedback revoked by ${toSummaryValue(eventArgs['clientAddress'], 'unknown')}`
  }

  if (eventName === 'Transfer') {
    const from = toSummaryValue(eventArgs['from'], 'unknown')
    const to = toSummaryValue(eventArgs['to'], 'unknown')
    return `${from} -> ${to}`
  }

  if (eventName === 'URIUpdated') {
    return `URI updated by ${toSummaryValue(eventArgs['updatedBy'], 'unknown')}`
  }

  if (eventName === 'MetadataSet') {
    return `Metadata key ${toSummaryValue(eventArgs['metadataKey'], 'unknown')}`
  }

  return ''
}

export function toDashboardActivityItem(evt: EventFact): DashboardActivityItem {
  const eventArgs = isRecord(evt.eventArgs) ? evt.eventArgs : {}

  return {
    chainId: evt.chainId,
    eventName: evt.eventName,
    agentId: resolveAgentId(eventArgs),
    agentName: null,
    agentImageUrl: null,
    txHash: evt.txHash,
    logIndex: evt.logIndex,
    timestamp: toTimestampMs(evt.timestamp),
    summary: buildEventSummary(evt.eventName, eventArgs),
  }
}

export async function toDashboardActivityItems(eventFacts: EventFact[]): Promise<DashboardActivityItem[]> {
  const items = eventFacts.map((eventFact) => toDashboardActivityItem(eventFact))
  if (items.length === 0) return items

  const metadataLookup = await buildMetadataLookup(items)

  return items.map((item) => {
    const parsedAgentId = parseAgentIdNumber(item.agentId)
    if (parsedAgentId === null) {
      return item
    }

    const metadata = metadataLookup.get(metadataLookupKey(item.chainId, parsedAgentId))
    if (!metadata) {
      return item
    }

    return {
      ...item,
      agentName: metadata.name,
      agentImageUrl: metadata.image,
    }
  })
}
