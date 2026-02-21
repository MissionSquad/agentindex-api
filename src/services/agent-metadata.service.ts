import { createHash } from 'node:crypto'
import type { Document } from 'mongodb'
import { env } from '../env'
import type { AgentMetadata, AgentMetadataRawSnapshot, EventFact } from '../types/mongo'
import { log } from '../utils/logger'
import { getAgentMetadataByAgent, getAgentMetadataClient, upsertAgentMetadata } from '../repositories/agent-metadata.repository'
import { upsertAgentMetadataRawSnapshot } from '../repositories/agent-metadata-raw.repository'
import { fetchOffchainContent, parseRegistrationJson } from './offchain-fetch.service'

interface ExtractedMetadata {
  name: string | null
  description: string | null
  type: string | null
  image: string | null
  active: boolean | null
  x402Support: boolean | null
  erc8004Support: boolean | null
  services: string[]
  registrations: string[]
  supportedTrusts: string[]
  rawMetadata: Record<string, unknown> | null
  serviceEntries: Record<string, unknown>[]
  registrationEntries: Record<string, unknown>[]
  serviceEndpoints: string[]
  serviceVersions: string[]
  serviceSkills: string[]
  serviceDomains: string[]
  serviceTools: string[]
  serviceCapabilities: string[]
  serviceA2aSkills: string[]
  serviceMcpTools: string[]
  registrationRegistries: string[]
  registrationAgentIds: number[]
  attributeProtocols: string[]
  attributeDataFeeds: string[]
  attributeTags: string[]
  attributeBlockchains: string[]
  attributeChainIds: number[]
  contactEmails: string[]
  contactTwitter: string[]
  searchTerms: string[]
}

interface ResolveAgentMetadataParams {
  chainId: number
  agentId: number
  uri: string
  eventTimestamp: number
  eventTxHash: string
  eventBlockNumber: number
  forceReprocess?: boolean
}

interface AgentUriEvent {
  agentId: number
  uri: string
  eventTimestamp: number
  eventTxHash: string
  eventBlockNumber: number
}

export const IGNORED_METADATA_URI_ERROR = 'URI ignored by metadata policy'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized
}

function normalizeNumberList(values: number[]): number[] {
  const seen = new Set<number>()
  const normalized: number[] = []

  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return normalizeStringList(
    value.flatMap((entry): string[] => {
      const parsed = nonEmptyString(entry)
      return parsed !== null ? [parsed] : []
    }),
  )
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)
}

function looksLikeTwitter(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    lower.startsWith('@')
    || lower.includes('twitter.com/')
    || lower.includes('x.com/')
  )
}

function tokenizeSearchValue(value: string): string[] {
  const lower = value.trim().toLowerCase()
  if (lower.length === 0) return []
  const tokens = lower
    .split(/[^a-z0-9@._:/#-]+/)
    .filter((token) => token.length >= 2 && token.length <= 128)
  return [lower, ...tokens]
}

function buildSearchTerms(values: string[], maxTerms: number = 1200): string[] {
  const terms: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    for (const token of tokenizeSearchValue(value)) {
      if (seen.has(token)) continue
      seen.add(token)
      terms.push(token)
      if (terms.length >= maxTerms) {
        return terms
      }
    }
  }

  return terms
}

function collectScalarStrings(
  value: unknown,
  output: string[],
  depth: number = 0,
  maxDepth: number = 5,
  maxItems: number = 500,
): void {
  if (output.length >= maxItems) return
  if (depth > maxDepth) return

  if (typeof value === 'string') {
    const parsed = nonEmptyString(value)
    if (parsed !== null) output.push(parsed)
    return
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    output.push(String(value))
    return
  }

  if (typeof value === 'bigint') {
    output.push(String(value))
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectScalarStrings(entry, output, depth + 1, maxDepth, maxItems)
      if (output.length >= maxItems) return
    }
    return
  }

  if (!isRecord(value)) return
  for (const entry of Object.values(value)) {
    collectScalarStrings(entry, output, depth + 1, maxDepth, maxItems)
    if (output.length >= maxItems) return
  }
}

interface ExtractedServiceData {
  serviceEntries: Record<string, unknown>[]
  serviceNames: string[]
  serviceEndpoints: string[]
  serviceVersions: string[]
  serviceSkills: string[]
  serviceDomains: string[]
  serviceTools: string[]
  serviceCapabilities: string[]
  serviceA2aSkills: string[]
  serviceMcpTools: string[]
  contactEmails: string[]
  contactTwitter: string[]
}

function emptyExtractedServiceData(): ExtractedServiceData {
  return {
    serviceEntries: [],
    serviceNames: [],
    serviceEndpoints: [],
    serviceVersions: [],
    serviceSkills: [],
    serviceDomains: [],
    serviceTools: [],
    serviceCapabilities: [],
    serviceA2aSkills: [],
    serviceMcpTools: [],
    contactEmails: [],
    contactTwitter: [],
  }
}

function extractServiceData(rawServices: unknown): ExtractedServiceData {
  if (!Array.isArray(rawServices)) return emptyExtractedServiceData()

  const serviceEntries: Record<string, unknown>[] = []
  const names: string[] = []
  const endpoints: string[] = []
  const versions: string[] = []
  const skills: string[] = []
  const domains: string[] = []
  const tools: string[] = []
  const capabilities: string[] = []
  const a2aSkills: string[] = []
  const mcpTools: string[] = []
  const emails: string[] = []
  const twitter: string[] = []

  for (const entry of rawServices) {
    if (typeof entry === 'string') {
      const name = nonEmptyString(entry)
      if (name === null) continue
      serviceEntries.push({ name })
      names.push(name)
      continue
    }

    if (!isRecord(entry)) {
      continue
    }

    serviceEntries.push(entry)

    const name = nonEmptyString(entry.name)
    const endpoint = nonEmptyString(entry.endpoint)
    const version = nonEmptyString(entry.version)
    const description = nonEmptyString(entry.description)

    if (name !== null) names.push(name)
    if (endpoint !== null) endpoints.push(endpoint)
    if (version !== null) versions.push(version)
    if (description !== null) capabilities.push(description)

    skills.push(...toStringArray(entry.skills))
    domains.push(...toStringArray(entry.domains))
    tools.push(...toStringArray(entry.tools))
    capabilities.push(...toStringArray(entry.capabilities))
    a2aSkills.push(...toStringArray(entry.a2aSkills))
    mcpTools.push(...toStringArray(entry.mcpTools))

    if (endpoint !== null && looksLikeEmail(endpoint)) {
      emails.push(endpoint.toLowerCase())
    }
    if (endpoint !== null && looksLikeTwitter(endpoint)) {
      twitter.push(endpoint)
    }
  }

  return {
    serviceEntries,
    serviceNames: normalizeStringList(names),
    serviceEndpoints: normalizeStringList(endpoints),
    serviceVersions: normalizeStringList(versions),
    serviceSkills: normalizeStringList(skills),
    serviceDomains: normalizeStringList(domains),
    serviceTools: normalizeStringList(tools),
    serviceCapabilities: normalizeStringList(capabilities),
    serviceA2aSkills: normalizeStringList(a2aSkills),
    serviceMcpTools: normalizeStringList(mcpTools),
    contactEmails: normalizeStringList(emails),
    contactTwitter: normalizeStringList(twitter),
  }
}

interface ExtractedRegistrationData {
  registrationEntries: Record<string, unknown>[]
  registrations: string[]
  registrationRegistries: string[]
  registrationAgentIds: number[]
}

function extractRegistrationData(rawRegistrations: unknown): ExtractedRegistrationData {
  const registrationEntries: Record<string, unknown>[] = []
  const registrations: string[] = []
  const registries: string[] = []
  const agentIds: number[] = []

  if (!Array.isArray(rawRegistrations)) {
    return {
      registrationEntries,
      registrations,
      registrationRegistries: registries,
      registrationAgentIds: agentIds,
    }
  }

  for (const entry of rawRegistrations) {
    if (typeof entry === 'string') {
      const value = nonEmptyString(entry)
      if (value === null) continue
      registrations.push(value)
      registries.push(value)
      registrationEntries.push({ value })
      continue
    }

    if (!isRecord(entry)) {
      continue
    }

    registrationEntries.push(entry)

    const registry = nonEmptyString(entry.agentRegistry) ?? nonEmptyString(entry.registry)
    if (registry !== null) {
      registrations.push(registry)
      registries.push(registry)
    }

    const agentId = toFiniteNumber(entry.agentId)
    if (agentId !== null) {
      agentIds.push(agentId)
    }
  }

  return {
    registrationEntries,
    registrations: normalizeStringList(registrations),
    registrationRegistries: normalizeStringList(registries),
    registrationAgentIds: normalizeNumberList(agentIds),
  }
}

interface ExtractedAttributeData {
  protocols: string[]
  dataFeeds: string[]
  tags: string[]
  blockchains: string[]
  chainIds: number[]
}

function extractBlockchainData(value: unknown): { blockchains: string[]; chainIds: number[] } {
  const blockchains: string[] = []
  const chainIds: number[] = []

  if (value === null || value === undefined) {
    return { blockchains, chainIds }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractBlockchainData(entry)
      blockchains.push(...nested.blockchains)
      chainIds.push(...nested.chainIds)
    }
    return {
      blockchains: normalizeStringList(blockchains),
      chainIds: normalizeNumberList(chainIds),
    }
  }

  if (typeof value === 'string') {
    const parsed = nonEmptyString(value)
    if (parsed !== null) blockchains.push(parsed)
    return { blockchains: normalizeStringList(blockchains), chainIds }
  }

  if (!isRecord(value)) {
    const numeric = toFiniteNumber(value)
    if (numeric !== null) chainIds.push(numeric)
    return { blockchains, chainIds: normalizeNumberList(chainIds) }
  }

  const chain = nonEmptyString(value.chain) ?? nonEmptyString(value.blockchain) ?? nonEmptyString(value.network)
  if (chain !== null) blockchains.push(chain)

  const chainId = toFiniteNumber(value.chainId)
  if (chainId !== null) chainIds.push(chainId)

  return {
    blockchains: normalizeStringList(blockchains),
    chainIds: normalizeNumberList(chainIds),
  }
}

function extractAttributeData(decoded: Record<string, unknown>): ExtractedAttributeData {
  const attributes = isRecord(decoded.attributes) ? decoded.attributes : null
  const protocols = normalizeStringList([
    ...toStringArray(attributes?.protocols),
    ...toStringArray(decoded.protocols),
  ])
  const dataFeeds = normalizeStringList([
    ...toStringArray(attributes?.dataFeeds),
    ...toStringArray(decoded.dataFeeds),
  ])
  const tags = normalizeStringList([
    ...toStringArray(attributes?.tags),
    ...toStringArray(decoded.tags),
  ])

  const rootBlockchain = extractBlockchainData(decoded.blockchain)
  const attributeBlockchain = extractBlockchainData(attributes?.blockchain)
  const blockchains = normalizeStringList([
    ...rootBlockchain.blockchains,
    ...attributeBlockchain.blockchains,
  ])
  const chainIds = normalizeNumberList([
    ...rootBlockchain.chainIds,
    ...attributeBlockchain.chainIds,
  ])

  return {
    protocols,
    dataFeeds,
    tags,
    blockchains,
    chainIds,
  }
}

function emptyExtractedMetadata(): ExtractedMetadata {
  return {
    name: null,
    description: null,
    type: null,
    image: null,
    active: null,
    x402Support: null,
    erc8004Support: null,
    services: [],
    registrations: [],
    supportedTrusts: [],
    rawMetadata: null,
    serviceEntries: [],
    registrationEntries: [],
    serviceEndpoints: [],
    serviceVersions: [],
    serviceSkills: [],
    serviceDomains: [],
    serviceTools: [],
    serviceCapabilities: [],
    serviceA2aSkills: [],
    serviceMcpTools: [],
    registrationRegistries: [],
    registrationAgentIds: [],
    attributeProtocols: [],
    attributeDataFeeds: [],
    attributeTags: [],
    attributeBlockchains: [],
    attributeChainIds: [],
    contactEmails: [],
    contactTwitter: [],
    searchTerms: [],
  }
}

export function computeUriHash(uri: string): string {
  return createHash('sha256').update(uri).digest('hex')
}

function normalizeUriForPolicy(uri: string): string {
  const trimmed = uri.trim().toLowerCase()
  if (trimmed.length === 0) return ''
  return trimmed.replace(/\/+$/, '')
}

function uriMatchesPrefix(uri: string, prefix: string): boolean {
  const normalizedUri = normalizeUriForPolicy(uri)
  const normalizedPrefix = normalizeUriForPolicy(prefix)
  if (normalizedUri.length === 0 || normalizedPrefix.length === 0) return false
  return (
    normalizedUri === normalizedPrefix
    || normalizedUri.startsWith(`${normalizedPrefix}/`)
    || normalizedUri.startsWith(`${normalizedPrefix}?`)
    || normalizedUri.startsWith(`${normalizedPrefix}#`)
  )
}

export function isIgnoredMetadataUri(uri: string): boolean {
  if (env.METADATA_IGNORED_URI_PREFIXES.length === 0) return false
  return env.METADATA_IGNORED_URI_PREFIXES.some((prefix) => uriMatchesPrefix(uri, prefix))
}

export function extractAgentMetadata(decoded: unknown): ExtractedMetadata {
  const empty = emptyExtractedMetadata()
  if (!isRecord(decoded)) return empty

  const name = typeof decoded.name === 'string' && decoded.name.length > 0
    ? decoded.name
    : null

  const description = typeof decoded.description === 'string' && decoded.description.length > 0
    ? decoded.description
    : null

  const type = typeof decoded.type === 'string' && decoded.type.length > 0
    ? decoded.type
    : null

  const image = typeof decoded.image === 'string' && decoded.image.length > 0
    ? decoded.image
    : null

  const active = typeof decoded.active === 'boolean' ? decoded.active : null

  const rawX402Upper = decoded.x402Support
  const rawX402Lower = decoded['x402support']
  const x402Support = typeof rawX402Upper === 'boolean'
    ? rawX402Upper
    : typeof rawX402Lower === 'boolean'
      ? rawX402Lower
      : null

  const raw8004 = decoded['8004Support']
  const erc8004Support = typeof raw8004 === 'boolean' ? raw8004 : null

  const serviceData = extractServiceData(decoded.services)
  const registrationData = extractRegistrationData(decoded.registrations)

  const rawTrusts = decoded.supportedTrusts
  const rawTrust = decoded.supportedTrust
  const trustArrayPart: string[] = Array.isArray(rawTrusts)
    ? rawTrusts.filter((entry): entry is string => typeof entry === 'string')
    : []
  const trustFallbackPart: string[] = typeof rawTrust === 'string' && rawTrust.length > 0
    ? [rawTrust]
    : Array.isArray(rawTrust)
      ? rawTrust.filter((entry): entry is string => typeof entry === 'string')
      : []
  const supportedTrusts = trustArrayPart.length > 0 || trustFallbackPart.length > 0
    ? [...new Set([...trustArrayPart, ...trustFallbackPart])]
    : []

  const attributeData = extractAttributeData(decoded)

  const topLevelEmails = [
    nonEmptyString(decoded.email),
    nonEmptyString((isRecord(decoded.social) ? decoded.social.email : null)),
  ].filter((value): value is string => value !== null && looksLikeEmail(value))

  const topLevelTwitter = [
    nonEmptyString(decoded.twitter),
    nonEmptyString((isRecord(decoded.social) ? decoded.social.twitter : null)),
    nonEmptyString((isRecord(decoded.social) ? decoded.social.x : null)),
  ].filter((value): value is string => value !== null && looksLikeTwitter(value))

  const contactEmails = normalizeStringList([
    ...serviceData.contactEmails,
    ...topLevelEmails.map((value) => value.toLowerCase()),
  ])
  const contactTwitter = normalizeStringList([
    ...serviceData.contactTwitter,
    ...topLevelTwitter,
  ])

  const scalarValues: string[] = []
  collectScalarStrings(decoded, scalarValues)
  const searchTerms = buildSearchTerms([
    ...(name ? [name] : []),
    ...(description ? [description] : []),
    ...(type ? [type] : []),
    ...(image ? [image] : []),
    ...serviceData.serviceNames,
    ...serviceData.serviceEndpoints,
    ...serviceData.serviceVersions,
    ...serviceData.serviceSkills,
    ...serviceData.serviceDomains,
    ...serviceData.serviceTools,
    ...serviceData.serviceCapabilities,
    ...serviceData.serviceA2aSkills,
    ...serviceData.serviceMcpTools,
    ...registrationData.registrations,
    ...registrationData.registrationRegistries,
    ...registrationData.registrationAgentIds.map(String),
    ...supportedTrusts,
    ...attributeData.protocols,
    ...attributeData.dataFeeds,
    ...attributeData.tags,
    ...attributeData.blockchains,
    ...attributeData.chainIds.map(String),
    ...contactEmails,
    ...contactTwitter,
    ...scalarValues,
  ])

  return {
    name,
    description,
    type,
    image,
    active,
    x402Support,
    erc8004Support,
    services: serviceData.serviceNames,
    registrations: registrationData.registrations,
    supportedTrusts,
    rawMetadata: decoded,
    serviceEntries: serviceData.serviceEntries,
    registrationEntries: registrationData.registrationEntries,
    serviceEndpoints: serviceData.serviceEndpoints,
    serviceVersions: serviceData.serviceVersions,
    serviceSkills: serviceData.serviceSkills,
    serviceDomains: serviceData.serviceDomains,
    serviceTools: serviceData.serviceTools,
    serviceCapabilities: serviceData.serviceCapabilities,
    serviceA2aSkills: serviceData.serviceA2aSkills,
    serviceMcpTools: serviceData.serviceMcpTools,
    registrationRegistries: registrationData.registrationRegistries,
    registrationAgentIds: registrationData.registrationAgentIds,
    attributeProtocols: attributeData.protocols,
    attributeDataFeeds: attributeData.dataFeeds,
    attributeTags: attributeData.tags,
    attributeBlockchains: attributeData.blockchains,
    attributeChainIds: attributeData.chainIds,
    contactEmails,
    contactTwitter,
    searchTerms,
  }
}

function toAgentIdNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toTimestampMs(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : 0

  if (parsed > 0 && parsed < 1_000_000_000_000) return parsed * 1000
  return parsed
}

function fallbackMetadata(
  params: ResolveAgentMetadataParams,
  now: number,
  status: 'failed' | 'pending',
  resolveError: string,
): AgentMetadata {
  const { chainId, agentId, uri, eventTimestamp, eventTxHash, eventBlockNumber } = params
  return {
    id: `${chainId}:${agentId}`,
    chainId,
    agentId,
    uri,
    uriHash: computeUriHash(uri),
    ...emptyExtractedMetadata(),
    resolveStatus: status,
    resolveError,
    resolvedAt: now,
    eventTimestamp,
    eventTxHash,
    eventBlockNumber,
  }
}

function buildRawSnapshot(
  params: ResolveAgentMetadataParams,
  now: number,
  resolveStatus: 'resolved' | 'failed' | 'pending',
  resolveError: string | null,
  rawMetadata: Record<string, unknown> | null,
  rawContent: string | null,
): AgentMetadataRawSnapshot {
  const { chainId, agentId, uri, eventTimestamp, eventTxHash, eventBlockNumber } = params
  const uriHash = computeUriHash(uri)
  return {
    id: `${chainId}:${agentId}:${uriHash}`,
    chainId,
    agentId,
    uri,
    uriHash,
    rawMetadata,
    rawContent,
    resolveStatus,
    resolveError,
    resolvedAt: now,
    eventTimestamp,
    eventTxHash,
    eventBlockNumber,
  }
}

async function persistRawSnapshot(snapshot: AgentMetadataRawSnapshot): Promise<void> {
  try {
    await upsertAgentMetadataRawSnapshot(snapshot)
  } catch (error) {
    log({
      level: 'warn',
      msg: `Failed to upsert raw metadata snapshot for agent ${snapshot.agentId}`,
      error,
    })
  }
}

function asUtf8(content: Buffer, maxBytes: number = 1_000_000): string {
  if (content.byteLength <= maxBytes) {
    return content.toString('utf-8')
  }
  return content.subarray(0, maxBytes).toString('utf-8')
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return

  const workerCount = Math.min(Math.max(1, concurrency), items.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = cursor
        cursor += 1
        if (currentIndex >= items.length) {
          return
        }
        await processor(items[currentIndex])
      }
    }),
  )
}

export async function resolveAndPersistAgentMetadata(
  params: ResolveAgentMetadataParams,
): Promise<AgentMetadata> {
  const {
    chainId,
    agentId,
    uri,
    eventTimestamp,
    eventTxHash,
    eventBlockNumber,
    forceReprocess = false,
  } = params
  const id = `${chainId}:${agentId}`
  const uriHash = computeUriHash(uri)
  const now = Date.now()

  const existing = await getAgentMetadataByAgent(chainId, agentId)
  if (
    !forceReprocess
    && existing !== null
    && existing.uriHash === uriHash
    && existing.resolveStatus === 'resolved'
  ) {
    const unchanged: AgentMetadata = {
      ...existing,
      uri,
      eventTimestamp,
      eventTxHash,
      eventBlockNumber,
    }
    await upsertAgentMetadata(unchanged)
    return unchanged
  }

  if (isIgnoredMetadataUri(uri)) {
    const ignored = fallbackMetadata(params, now, 'failed', IGNORED_METADATA_URI_ERROR)
    await upsertAgentMetadata(ignored)
    await persistRawSnapshot(
      buildRawSnapshot(params, now, 'failed', IGNORED_METADATA_URI_ERROR, null, null),
    )
    log({ level: 'info', msg: `Agent ${agentId}: skipped ignored metadata URI ${uri.slice(0, 80)}` })
    return ignored
  }

  try {
    const content = await fetchOffchainContent(uri)
    if (content === null) {
      const failed = fallbackMetadata(params, now, 'failed', 'Failed to fetch URI content')
      await upsertAgentMetadata(failed)
      await persistRawSnapshot(
        buildRawSnapshot(params, now, 'failed', 'Failed to fetch URI content', null, null),
      )
      log({ level: 'warn', msg: `Agent ${agentId}: URI resolution returned null for ${uri.slice(0, 80)}` })
      return failed
    }

    const parsed = parseRegistrationJson(content)
    if (parsed === null) {
      const failed = fallbackMetadata(params, now, 'failed', 'URI content is not valid JSON')
      await upsertAgentMetadata(failed)
      await persistRawSnapshot(
        buildRawSnapshot(params, now, 'failed', 'URI content is not valid JSON', null, asUtf8(content)),
      )
      log({ level: 'warn', msg: `Agent ${agentId}: JSON parse failed for ${uri.slice(0, 80)}` })
      return failed
    }

    const extracted = extractAgentMetadata(parsed)
    const resolved: AgentMetadata = {
      id,
      chainId,
      agentId,
      uri,
      uriHash,
      ...extracted,
      resolveStatus: 'resolved',
      resolveError: null,
      resolvedAt: now,
      eventTimestamp,
      eventTxHash,
      eventBlockNumber,
    }
    await upsertAgentMetadata(resolved)
    await persistRawSnapshot(
      buildRawSnapshot(params, now, 'resolved', null, extracted.rawMetadata, null),
    )
    log({ level: 'info', msg: `Agent ${agentId}: metadata resolved — name="${extracted.name}"` })
    return resolved
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const failed = fallbackMetadata(params, now, 'failed', message)
    await upsertAgentMetadata(failed)
    await persistRawSnapshot(
      buildRawSnapshot(params, now, 'failed', message, null, null),
    )
    log({ level: 'error', msg: `Agent ${agentId}: metadata resolution error`, error })
    return failed
  }
}

function isMoreRecentEvent(left: EventFact, right: EventFact): boolean {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber > right.blockNumber
  return left.logIndex > right.logIndex
}

function extractUriEvents(eventFacts: EventFact[]): AgentUriEvent[] {
  const latestByAgent = new Map<number, EventFact>()

  for (const eventFact of eventFacts) {
    if (eventFact.eventName !== 'Registered' && eventFact.eventName !== 'URIUpdated') {
      continue
    }

    const args = eventFact.eventArgs as Record<string, unknown>
    const agentId = toAgentIdNumber(args.agentId)
    if (agentId === null) continue

    const existing = latestByAgent.get(agentId)
    if (!existing || isMoreRecentEvent(eventFact, existing)) {
      latestByAgent.set(agentId, eventFact)
    }
  }

  const result: AgentUriEvent[] = []
  for (const [agentId, eventFact] of latestByAgent.entries()) {
    const args = eventFact.eventArgs as Record<string, unknown>
    const uri = eventFact.eventName === 'URIUpdated'
      ? toStringOrNull(args.newURI)
      : toStringOrNull(args.agentURI)

    if (!uri || uri.length === 0) continue

    result.push({
      agentId,
      uri,
      eventTimestamp: toTimestampMs(eventFact.timestamp),
      eventTxHash: eventFact.txHash,
      eventBlockNumber: eventFact.blockNumber,
    })
  }

  return result
}

export async function resolveAgentMetadataFromEvents(
  chainId: number,
  eventFacts: EventFact[],
): Promise<void> {
  const uriEvents = extractUriEvents(eventFacts)
  if (uriEvents.length === 0) return

  await processWithConcurrency(
    uriEvents,
    env.METADATA_FETCH_CONCURRENCY,
    async (entry) => {
      try {
        await resolveAndPersistAgentMetadata({
          chainId,
          agentId: entry.agentId,
          uri: entry.uri,
          eventTimestamp: entry.eventTimestamp,
          eventTxHash: entry.eventTxHash,
          eventBlockNumber: entry.eventBlockNumber,
        })
      } catch (error) {
        log({
          level: 'error',
          msg: `Agent ${entry.agentId}: metadata resolution failed during block processing`,
          error,
        })
      }
    },
  )
}

export async function reResolveStaleMetadata(
  chainId: number,
  maxAgeMs: number,
  batchSize: number,
): Promise<number> {
  const db = await getAgentMetadataClient()
  const cutoff = Date.now() - maxAgeMs

  const staleRows = await db.find(
    {
      chainId,
      resolvedAt: { $lt: cutoff },
      uri: { $not: { $regex: '^data:' } },
    } as Document,
    { resolvedAt: 1 },
    batchSize,
  )

  let count = 0
  for (const row of staleRows) {
    if (isIgnoredMetadataUri(row.uri)) {
      continue
    }
    try {
      const result = await resolveAndPersistAgentMetadata({
        chainId,
        agentId: row.agentId,
        uri: row.uri,
        eventTimestamp: row.eventTimestamp,
        eventTxHash: row.eventTxHash,
        eventBlockNumber: row.eventBlockNumber,
      })
      if (result.resolveStatus === 'resolved') {
        count += 1
      }
    } catch (error) {
      log({ level: 'warn', msg: `Re-resolution failed for agent ${row.agentId}`, error })
    }
  }

  return count
}

export async function retryFailedResolutions(
  chainId: number,
  maxAgeMs: number,
  batchSize: number,
): Promise<number> {
  const db = await getAgentMetadataClient()
  const cutoff = Date.now() - maxAgeMs

  const failedRows = await db.find(
    {
      chainId,
      resolveStatus: 'failed',
      resolvedAt: { $lt: cutoff },
    } as Document,
    { resolvedAt: 1 },
    batchSize,
  )

  let count = 0
  for (const row of failedRows) {
    if (isIgnoredMetadataUri(row.uri)) {
      continue
    }
    try {
      const result = await resolveAndPersistAgentMetadata({
        chainId,
        agentId: row.agentId,
        uri: row.uri,
        eventTimestamp: row.eventTimestamp,
        eventTxHash: row.eventTxHash,
        eventBlockNumber: row.eventBlockNumber,
      })
      if (result.resolveStatus === 'resolved') {
        count += 1
      }
    } catch (error) {
      log({ level: 'warn', msg: `Retry resolution failed for agent ${row.agentId}`, error })
    }
  }

  return count
}
