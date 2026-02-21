import { Router, Request, Response } from 'express'
import type { Document } from 'mongodb'
import { getEventFactClient } from '../repositories/event.repository'
import { getAgentMetadataClient } from '../repositories/agent-metadata.repository'
import { getTxFactClient } from '../repositories/transaction.repository'
import { env } from '../env'
import type { AgentMetadata } from '../types/mongo'

function searchTokens(query: string): string[] {
  const lower = query.trim().toLowerCase()
  if (lower.length === 0) return []

  const tokens = lower
    .split(/[^a-z0-9@._:/#-]+/)
    .filter((token) => token.length >= 2 && token.length <= 128)

  if (tokens.length === 0) return [lower]
  return Array.from(new Set([lower, ...tokens]))
}

type MetadataSearchStatus = 'resolved' | 'failed' | 'pending' | 'all'

function firstQueryString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') return entry
    }
  }
  return null
}

function parseBooleanQuery(value: unknown): boolean | undefined {
  const normalized = firstQueryString(value)?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return undefined
}

function parseBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = firstQueryString(value)
  const parsed = raw ? parseInt(raw, 10) : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseChainId(value: unknown): number {
  const parsed = parseBoundedInt(value, env.CHAIN_ID, 1, Number.MAX_SAFE_INTEGER)
  return Number.isFinite(parsed) ? parsed : env.CHAIN_ID
}

function parseMetadataSearchStatus(value: unknown): MetadataSearchStatus {
  const normalized = firstQueryString(value)?.trim().toLowerCase()
  if (normalized === 'failed' || normalized === 'pending' || normalized === 'resolved' || normalized === 'all') {
    return normalized
  }
  return 'resolved'
}

function parseStringListQuery(value: unknown): string[] {
  const values: string[] = []
  const push = (entry: string): void => {
    const parts = entry.split(',')
    for (const part of parts) {
      const normalized = part.trim().toLowerCase()
      if (normalized.length > 0) values.push(normalized)
    }
  }

  if (typeof value === 'string') {
    push(value)
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') push(entry)
    }
  }

  return Array.from(new Set(values))
}

function parseIntListQuery(value: unknown): number[] {
  const strings = parseStringListQuery(value)
  const parsed: number[] = []
  for (const token of strings) {
    const numberValue = Number(token)
    if (Number.isFinite(numberValue)) parsed.push(numberValue)
  }
  return Array.from(new Set(parsed))
}

function toAgentSearchItem(row: AgentMetadata, includeRaw: boolean): Record<string, unknown> {
  const item: Record<string, unknown> = {
    chainId: row.chainId,
    agentId: row.agentId,
    uri: row.uri,
    uriHash: row.uriHash,
    name: row.name,
    description: row.description,
    type: row.type,
    image: row.image,
    active: row.active,
    x402Support: row.x402Support,
    erc8004Support: row.erc8004Support,
    services: row.services,
    registrations: row.registrations,
    supportedTrusts: row.supportedTrusts,
    serviceEntries: row.serviceEntries ?? [],
    registrationEntries: row.registrationEntries ?? [],
    serviceEndpoints: row.serviceEndpoints ?? [],
    serviceVersions: row.serviceVersions ?? [],
    serviceSkills: row.serviceSkills ?? [],
    serviceDomains: row.serviceDomains ?? [],
    serviceTools: row.serviceTools ?? [],
    serviceCapabilities: row.serviceCapabilities ?? [],
    serviceA2aSkills: row.serviceA2aSkills ?? [],
    serviceMcpTools: row.serviceMcpTools ?? [],
    registrationRegistries: row.registrationRegistries ?? [],
    registrationAgentIds: row.registrationAgentIds ?? [],
    attributeProtocols: row.attributeProtocols ?? [],
    attributeDataFeeds: row.attributeDataFeeds ?? [],
    attributeTags: row.attributeTags ?? [],
    attributeBlockchains: row.attributeBlockchains ?? [],
    attributeChainIds: row.attributeChainIds ?? [],
    contactEmails: row.contactEmails ?? [],
    contactTwitter: row.contactTwitter ?? [],
    resolveStatus: row.resolveStatus,
    resolveError: row.resolveError,
    resolvedAt: row.resolvedAt,
    eventTimestamp: row.eventTimestamp,
    eventTxHash: row.eventTxHash,
    eventBlockNumber: row.eventBlockNumber,
  }

  if (includeRaw) {
    item.rawMetadata = row.rawMetadata ?? null
  }

  return item
}

export function createSearchRouter(): Router {
  const router = Router()

  /**
   * GET /v1/search?q=<query>
   * Global search. Resolves agent IDs, addresses, tx hashes, and text.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string ?? '').trim()
      if (!q) {
        res.status(400).json({ error: 'Query parameter "q" is required' })
        return
      }

      const parsedPage = parseInt(req.query.page as string, 10)
      const page = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1
      const parsedLimit = parseInt(req.query.limit as string, 10)
      const limit = !isNaN(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 25
      const skip = (page - 1) * limit

      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const eventDb = await getEventFactClient()
      const txDb = await getTxFactClient()
      const results: Array<{
        type: 'agent' | 'address' | 'transaction' | 'tag' | 'endpoint'
        id: string
        title: string
        subtitle: string
        route: string
      }> = []

      const dedupe = new Set<string>()
      const pushResult = (item: {
        type: 'agent' | 'address' | 'transaction' | 'tag' | 'endpoint'
        id: string
        title: string
        subtitle: string
        route: string
      }): void => {
        const key = `${item.type}:${item.id}:${item.route}`
        if (dedupe.has(key)) return
        dedupe.add(key)
        results.push(item)
      }

      // 1. Check if it's a numeric agent ID
      const numericId = parseInt(q, 10)
      if (!isNaN(numericId) && String(numericId) === q) {
        const registration = await eventDb.findOne({
          chainId,
          eventName: 'Registered',
          'eventArgs.agentId': numericId,
        } as Document)

        if (registration) {
          pushResult({
            type: 'agent',
            id: String(numericId),
            title: `Agent ${numericId}`,
            subtitle: `Registered at block ${registration.blockNumber}`,
            route: `/agents/${numericId}`,
          })
        }
      }

      // 2. Check if it's an Ethereum address
      if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
        const address = q.toLowerCase()
        const txCount = await txDb.count({
          chainId,
          $or: [{ from: address }, { to: address }],
        } as Document)

        pushResult({
          type: 'address',
          id: address,
          title: address,
          subtitle: `${txCount} related transactions`,
          route: `/address/${address}`,
        })
      }

      // 3. Check if it's a transaction hash
      if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
        const txHash = q.toLowerCase()
        const tx = await txDb.findOne({ chainId, txHash })

        if (tx) {
          pushResult({
            type: 'transaction',
            id: txHash,
            title: txHash,
            subtitle: `Block ${tx.blockNumber}`,
            route: `/tx/${txHash}`,
          })
        }
      }

      // 4. Text search against tags and endpoint data
      const feedbackRows = await eventDb.find(
        {
          chainId,
          eventName: 'NewFeedback',
          $or: [
            { 'eventArgs.tag1': { $regex: q, $options: 'i' } },
            { 'eventArgs.tag2': { $regex: q, $options: 'i' } },
            { 'eventArgs.endpoint': { $regex: q, $options: 'i' } },
          ],
        } as Document,
        { blockNumber: -1 },
        100,
      )

      for (const row of feedbackRows) {
        const eventArgs = row.eventArgs as Record<string, unknown>
        const agentId = eventArgs['agentId']
        const tag1 = eventArgs['tag1']
        const tag2 = eventArgs['tag2']
        const endpoint = eventArgs['endpoint']

        if (typeof tag1 === 'string' && tag1.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            type: 'tag',
            id: `tag:${tag1.toLowerCase()}`,
            title: `Tag: ${tag1}`,
            subtitle: `Agent ${String(agentId ?? 'unknown')}`,
            route: `/reputation?tag=${encodeURIComponent(tag1)}`,
          })
        }

        if (typeof tag2 === 'string' && tag2.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            type: 'tag',
            id: `tag:${tag2.toLowerCase()}`,
            title: `Tag: ${tag2}`,
            subtitle: `Agent ${String(agentId ?? 'unknown')}`,
            route: `/reputation?tag=${encodeURIComponent(tag2)}`,
          })
        }

        if (typeof endpoint === 'string' && endpoint.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            type: 'endpoint',
            id: `endpoint:${endpoint.toLowerCase()}`,
            title: `Endpoint: ${endpoint}`,
            subtitle: `Agent ${String(agentId ?? 'unknown')}`,
            route: `/reputation?endpoint=${encodeURIComponent(endpoint)}`,
          })
        }
      }

      // 5. Indexed metadata-token search (services/tools/skills/tags/contacts/etc.)
      const metadataDb = await getAgentMetadataClient()
      const tokens = searchTokens(q)
      const tokenFilter = tokens.length <= 1
        ? { searchTerms: tokens[0] }
        : { searchTerms: { $all: tokens.slice(0, 5) } }

      const tokenMatches = tokens.length === 0
        ? []
        : await metadataDb.find(
          {
            chainId,
            resolveStatus: 'resolved',
            ...tokenFilter,
          } as Document,
          { resolvedAt: -1 },
          25,
        )

      for (const match of tokenMatches) {
        pushResult({
          type: 'agent',
          id: String(match.agentId),
          title: match.name ?? `Agent ${match.agentId}`,
          subtitle: `Agent ${match.agentId}`,
          route: `/agents/${match.agentId}`,
        })
      }

      // 6. Name search against persisted agent metadata
      const nameMatches = await metadataDb.find(
        {
          chainId,
          name: { $regex: q, $options: 'i' },
          resolveStatus: 'resolved',
        } as Document,
        { name: 1 },
        10,
      )

      for (const match of nameMatches) {
        pushResult({
          type: 'agent',
          id: String(match.agentId),
          title: match.name ?? `Agent ${match.agentId}`,
          subtitle: `Agent ${match.agentId}`,
          route: `/agents/${match.agentId}`,
        })
      }

      const total = results.length
      const paginated = results.slice(skip, skip + limit)

      res.json({
        query: q,
        results: {
          items: paginated,
          meta: {
            page,
            limit,
            total,
            hasNextPage: page * limit < total,
          },
        },
      })
    } catch (error) {
      res.status(500).json({ error: 'Search failed' })
    }
  })

  /**
   * GET /v1/search/agents
   * Structured metadata search over persisted agent metadata facets.
   */
  router.get('/agents', async (req: Request, res: Response) => {
    try {
      const chainId = parseChainId(req.query.chainId)
      const page = parseBoundedInt(req.query.page, 1, 1, 1_000_000)
      const limit = parseBoundedInt(req.query.limit, 25, 1, 100)
      const skip = (page - 1) * limit
      const status = parseMetadataSearchStatus(req.query.status)
      const includeRaw = parseBooleanQuery(req.query.includeRaw) === true
      const x402Support = parseBooleanQuery(req.query.x402Support)
      const active = parseBooleanQuery(req.query.active)

      const q = firstQueryString(req.query.q)?.trim() ?? ''
      const qTokens = searchTokens(q).slice(0, 8)

      const serviceTerms = parseStringListQuery(req.query.service)
      const endpointTerms = parseStringListQuery(req.query.endpoint)
      const versionTerms = parseStringListQuery(req.query.version)
      const skillTerms = parseStringListQuery(req.query.skill)
      const domainTerms = parseStringListQuery(req.query.domain)
      const toolTerms = parseStringListQuery(req.query.tool)
      const capabilityTerms = parseStringListQuery(req.query.capability)
      const a2aSkillTerms = parseStringListQuery(req.query.a2aSkill)
      const mcpToolTerms = parseStringListQuery(req.query.mcpTool)
      const registrationTerms = parseStringListQuery(req.query.registration)
      const registrationRegistryTerms = parseStringListQuery(req.query.registrationRegistry)
      const trustTerms = parseStringListQuery(req.query.trust)
      const protocolTerms = parseStringListQuery(req.query.protocol)
      const dataFeedTerms = parseStringListQuery(req.query.dataFeed)
      const tagTerms = parseStringListQuery(req.query.tag)
      const blockchainTerms = parseStringListQuery(req.query.blockchain)
      const emailTerms = parseStringListQuery(req.query.email)
      const twitterTerms = parseStringListQuery(req.query.twitter)
      const typeTerms = parseStringListQuery(req.query.type)
      const nameTerms = parseStringListQuery(req.query.name)

      const registrationAgentIds = parseIntListQuery(req.query.registrationAgentId)
      const attributeChainIds = parseIntListQuery(req.query.attributeChainId)

      const andClauses: Document[] = [{ chainId }]

      if (status !== 'all') andClauses.push({ resolveStatus: status })
      if (x402Support !== undefined) andClauses.push({ x402Support })
      if (active !== undefined) andClauses.push({ active })
      if (registrationAgentIds.length > 0) {
        andClauses.push({ registrationAgentIds: { $in: registrationAgentIds } })
      }
      if (attributeChainIds.length > 0) {
        andClauses.push({ attributeChainIds: { $in: attributeChainIds } })
      }
      if (qTokens.length > 0) {
        andClauses.push({ searchTerms: { $all: qTokens } })
      }

      const tokenGroups: string[][] = [
        serviceTerms,
        endpointTerms,
        versionTerms,
        skillTerms,
        domainTerms,
        toolTerms,
        capabilityTerms,
        a2aSkillTerms,
        mcpToolTerms,
        registrationTerms,
        registrationRegistryTerms,
        trustTerms,
        protocolTerms,
        dataFeedTerms,
        tagTerms,
        blockchainTerms,
        emailTerms,
        twitterTerms,
        typeTerms,
        nameTerms,
      ]

      for (const group of tokenGroups) {
        if (group.length > 0) {
          andClauses.push({ searchTerms: { $in: group } })
        }
      }

      const filter = andClauses.length === 1
        ? andClauses[0]
        : { $and: andClauses }

      const metadataDb = await getAgentMetadataClient()
      const [total, rows] = await Promise.all([
        metadataDb.count(filter as Document),
        metadataDb.find(filter as Document, { resolvedAt: -1 }, limit, skip),
      ])

      res.json({
        query: q,
        filters: {
          status,
          x402Support: x402Support ?? null,
          active: active ?? null,
          service: serviceTerms,
          endpoint: endpointTerms,
          version: versionTerms,
          skill: skillTerms,
          domain: domainTerms,
          tool: toolTerms,
          capability: capabilityTerms,
          a2aSkill: a2aSkillTerms,
          mcpTool: mcpToolTerms,
          registration: registrationTerms,
          registrationRegistry: registrationRegistryTerms,
          registrationAgentId: registrationAgentIds,
          trust: trustTerms,
          protocol: protocolTerms,
          dataFeed: dataFeedTerms,
          tag: tagTerms,
          blockchain: blockchainTerms,
          attributeChainId: attributeChainIds,
          email: emailTerms,
          twitter: twitterTerms,
          type: typeTerms,
          name: nameTerms,
        },
        results: {
          items: rows.map((row) => toAgentSearchItem(row, includeRaw)),
          meta: {
            page,
            limit,
            total,
            hasNextPage: page * limit < total,
          },
        },
      })
    } catch (error) {
      res.status(500).json({ error: 'Agent metadata search failed' })
    }
  })

  return router
}
