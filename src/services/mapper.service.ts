import type { DecodedTransaction } from '../types/evm'
import type {
  TransactionFact,
  CallFact,
  EventFact,
  ReviewEdge,
  RegistrantEdge,
  AgentReviewEdge,
  ResponseEdge,
} from '../types/mongo'
import {
  TRACKED_ADDRESSES,
  TOPIC0_TO_EVENT_NAME,
  ARG_NORMALIZATION,
} from '../config/erc8004'
import { getRegistrantEdgeClient } from '../repositories/graph.repository'
import type { Document } from 'mongodb'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value < 1_000_000_000_000) return value * 1000
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      if (parsed > 0 && parsed < 1_000_000_000_000) return parsed * 1000
      return parsed
    }

    const dateParsed = Date.parse(value)
    if (Number.isFinite(dateParsed)) return dateParsed
  }

  return 0
}

/**
 * Maps a decoded transaction to canonical fact documents.
 */
export function mapTransactionFact(
  chainId: number,
  decoded: DecodedTransaction,
): TransactionFact {
  const tx = decoded.transaction
  const txHash = tx.hash.toLowerCase()
  const timestamp = toTimestampMs(tx.timestamp)
  const toAddress = typeof tx.to === 'string' ? tx.to.toLowerCase() : ''
  const blockNumber = typeof tx.blockNumber === 'number' ? tx.blockNumber : 0
  const blockHash = typeof tx.blockHash === 'string' ? tx.blockHash : ''
  const transactionIndex = typeof tx.transactionIndex === 'number' ? tx.transactionIndex : 0

  return {
    id: `${chainId}:${txHash}`,
    chainId,
    registryAddress: toAddress,
    txHash,
    blockNumber,
    blockHash,
    transactionIndex,
    timestamp,
    status: 'success',
    from: tx.from.toLowerCase(),
    to: toAddress,
    nonce: tx.nonce,
    value: tx.value,
    gas: tx.gas,
    gasUsed: tx.gasUsed,
    gasPrice: tx.gasPrice,
    maxFeePerGas: tx.maxFeePerGas ?? null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
    cumulativeGasUsed: tx.cumulativeGasUsed,
  }
}

/**
 * Maps a decoded transaction call to a call fact document.
 */
export function mapCallFact(
  chainId: number,
  decoded: DecodedTransaction,
): CallFact | null {
  const tx = decoded.transaction
  if (!tx.call) return null

  const txHash = tx.hash.toLowerCase()
  const rawArgs = isRecord(tx.call.args) ? { ...tx.call.args } : {}
  const normalizedArgs = normalizeArgs(tx.call.signature, rawArgs)

  return {
    id: `${chainId}:${txHash}`,
    chainId,
    txHash,
    functionName: tx.call.name,
    functionSignature: tx.call.signature,
    rawArgs,
    normalizedArgs,
  }
}

/**
 * Apply argument normalization rules from erc-8004-scan.md.
 */
function normalizeArgs(
  signature: string,
  rawArgs: Record<string, unknown>,
): Record<string, unknown> {
  const mapping = ARG_NORMALIZATION[signature]
  if (!mapping) return { ...rawArgs }

  const normalized: Record<string, unknown> = {}
  for (const [rawKey, value] of Object.entries(rawArgs)) {
    const normalizedKey = mapping[rawKey] ?? rawKey
    normalized[normalizedKey] = value
  }
  return normalized
}

/**
 * Maps function call names to the primary event they emit.
 */
const CALL_TO_PRIMARY_EVENT: Record<string, string> = {
  giveFeedback: 'NewFeedback',
  revokeFeedback: 'FeedbackRevoked',
  appendResponse: 'ResponseAppended',
  register: 'Registered',
  setMetadata: 'MetadataSet',
}

/**
 * Build eventArgs from decoded call.args and the transaction envelope
 * when the log event ABI decode did not produce args.
 */
function buildArgsFromCall(
  eventName: string,
  callName: string,
  callArgs: Record<string, unknown>,
  txFrom: string,
  topics: string[],
  data: string,
): Record<string, unknown> | null {
  // MetadataSet can be emitted by setMetadata or register calls.
  // agentId is always in topics[1]. metadataKey and metadataValue are
  // ABI-encoded in the data field as (string, bytes).
  if (eventName === 'MetadataSet') {
    const { metadataKey, metadataValue } = decodeAbiStringBytes(data)
    return {
      agentId: topicToNumber(topics[1]),
      metadataKey,
      metadataValue,
    }
  }

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

/**
 * Extract a numeric value from the first 32-byte word of hex-encoded event data.
 */
function extractFirstWord(data: string): number {
  if (!data || data === '0x' || data.length < 66) return 0
  const hex = data.startsWith('0x') ? data.slice(2, 66) : data.slice(0, 64)
  return Number(BigInt('0x' + hex))
}

/**
 * Parse a 32-byte hex-encoded topic into a number.
 */
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

  try {
    const stringOffset = readUint(0)
    const bytesOffset = readUint(32)
    const stringLen = readUint(stringOffset)
    const stringHex = hex.slice((stringOffset + 32) * 2, (stringOffset + 32) * 2 + stringLen * 2)
    const metadataKey = Buffer.from(stringHex, 'hex').toString('utf-8')
    const bytesLen = readUint(bytesOffset)
    const bytesHex = hex.slice((bytesOffset + 32) * 2, (bytesOffset + 32) * 2 + bytesLen * 2)
    const metadataValue = '0x' + bytesHex
    return { metadataKey, metadataValue }
  } catch {
    return { metadataKey: '', metadataValue: '' }
  }
}

/**
 * Maps decoded log events to event fact documents.
 */
export function mapEventFacts(
  chainId: number,
  decoded: DecodedTransaction,
): EventFact[] {
  const tx = decoded.transaction
  const txHash = tx.hash.toLowerCase()
  const timestamp = toTimestampMs(tx.timestamp)

  const facts: EventFact[] = []

  for (const logEvent of decoded.logEvents) {
    const address = logEvent.address.toLowerCase()
    if (!TRACKED_ADDRESSES.has(address)) continue
    if (logEvent.logIndex === null || logEvent.blockNumber === null || logEvent.transactionHash === null) {
      continue
    }

    const topic0 = (logEvent.topics[0] ?? '').toLowerCase()
    const eventName = logEvent.event?.name ?? TOPIC0_TO_EVENT_NAME[topic0] ?? ''
    const eventSignature = logEvent.event?.signature ?? ''
    let eventArgs: Record<string, unknown> = isRecord(logEvent.event?.args) ? logEvent.event.args : {}

    // Supplement from call.args when ABI decode did not produce event args
    if (Object.keys(eventArgs).length === 0 && tx.call && isRecord(tx.call.args)) {
      const supplemented = buildArgsFromCall(
        eventName,
        tx.call.name,
        tx.call.args as Record<string, unknown>,
        tx.from,
        logEvent.topics,
        logEvent.data,
      )
      if (supplemented) {
        eventArgs = supplemented
      }
    }

    facts.push({
      id: `${chainId}:${txHash}:${logEvent.logIndex}`,
      chainId,
      registryAddress: address,
      txHash,
      blockNumber: logEvent.blockNumber,
      timestamp,
      logIndex: logEvent.logIndex,
      topic0,
      topics: logEvent.topics,
      data: logEvent.data,
      eventName,
      eventSignature,
      eventArgs,
    })
  }

  return facts
}

/**
 * Derive graph edges from event facts.
 */
export async function deriveGraphEdges(
  chainId: number,
  eventFacts: EventFact[],
  _txHash?: string,
): Promise<{
  reviews: ReviewEdge[]
  registrants: RegistrantEdge[]
  agentReviews: AgentReviewEdge[]
  responses: ResponseEdge[]
}> {
  const reviews: ReviewEdge[] = []
  const registrants: RegistrantEdge[] = []
  const agentReviews: AgentReviewEdge[] = []
  const responses: ResponseEdge[] = []
  const ownerToRegisteredAgents = await loadRegistrantLookup(chainId, eventFacts)

  for (const evt of eventFacts) {
    if (evt.eventName === 'Registered') {
      const agentId = toNumber(evt.eventArgs['agentId'])
      const owner = toString(evt.eventArgs['owner']).toLowerCase()

      registrants.push({
        ownerAddress: owner,
        sourceAgentId: agentId,
        timestamp: evt.timestamp,
        txHash: evt.txHash,
        chainId,
      })
    }

    if (evt.eventName === 'NewFeedback') {
      const agentId = toNumber(evt.eventArgs['agentId'])
      const clientAddress = toString(evt.eventArgs['clientAddress']).toLowerCase()
      const feedbackIndex = toNumber(evt.eventArgs['feedbackIndex'])
      const value = toNumber(evt.eventArgs['value'])
      const valueDecimals = toNumber(evt.eventArgs['valueDecimals'])
      const score = value / Math.pow(10, valueDecimals)
      const tag1 = toString(evt.eventArgs['tag1'])
      const tag2 = toString(evt.eventArgs['tag2'])

      const feedbackId = `${chainId}:${agentId}:${clientAddress}:${feedbackIndex}`

      reviews.push({
        feedbackId,
        clientAddress,
        targetAgentId: agentId,
        score,
        tag1,
        tag2,
        timestamp: evt.timestamp,
        txHash: evt.txHash,
        chainId,
      })

      const ownerRegistrations = ownerToRegisteredAgents.get(clientAddress) ?? []
      for (const sourceAgentId of ownerRegistrations) {
        agentReviews.push({
          sourceAgentId,
          targetAgentId: agentId,
          feedbackId,
          viaAddress: clientAddress,
          timestamp: evt.timestamp,
          txHash: evt.txHash,
          chainId,
        })
      }
    }

    if (evt.eventName === 'ResponseAppended') {
      const agentId = toNumber(evt.eventArgs['agentId'])
      const clientAddress = toString(evt.eventArgs['clientAddress']).toLowerCase()
      const feedbackIndex = toNumber(evt.eventArgs['feedbackIndex'])
      const responder = toString(evt.eventArgs['responder']).toLowerCase()

      const feedbackId = `${chainId}:${agentId}:${clientAddress}:${feedbackIndex}`

      responses.push({
        feedbackId,
        responder,
        targetAgentId: agentId,
        timestamp: evt.timestamp,
        txHash: evt.txHash,
        chainId,
        logIndex: evt.logIndex,
      })
    }
  }

  return { reviews, registrants, agentReviews, responses }
}

async function loadRegistrantLookup(
  chainId: number,
  eventFacts: EventFact[],
): Promise<Map<string, number[]>> {
  const clientAddresses = Array.from(
    new Set(
      eventFacts
        .filter((evt) => evt.eventName === 'NewFeedback')
        .map((evt) => toString(evt.eventArgs['clientAddress']).toLowerCase())
        .filter((addr) => addr.length > 0),
    ),
  )

  if (clientAddresses.length === 0) {
    return new Map<string, number[]>()
  }

  const registrantDb = await getRegistrantEdgeClient()
  const ownerRegistrations = await registrantDb.find({
    chainId,
    ownerAddress: { $in: clientAddresses },
  } as unknown as Document)

  const lookup = new Map<string, number[]>()
  for (const reg of ownerRegistrations) {
    const owner = reg.ownerAddress.toLowerCase()
    const existing = lookup.get(owner)
    if (existing) {
      existing.push(reg.sourceAgentId)
    } else {
      lookup.set(owner, [reg.sourceAgentId])
    }
  }

  return lookup
}

function toNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'bigint') return Number(val)
  if (typeof val === 'string') return Number(val)
  return 0
}

function toString(val: unknown): string {
  if (typeof val === 'string') return val
  if (val == null) return ''
  return String(val)
}
