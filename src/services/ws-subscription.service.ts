import WebSocket from 'ws'
import { log } from '../utils/logger'
import { sleep } from '../utils/retry'
import { ERC8004_CONTRACTS } from '../config/erc8004'
import { getChainSyncState } from '../repositories/chain-state.repository'
import { fillGap } from './catchup.service'
import type { ScannerService } from './scanner.service'

interface WsSubscriptionOpts {
  wsUrl: string
  chainId: number
  scanner: ScannerService
  baseDelayMs: number
  maxDelayMs: number
  failureWindowMs: number
  cooldownMs: number
  onEvent?: (type: string, data: Record<string, unknown>) => void
}

const COOLDOWN_SKIP_LOG_INTERVAL_MS = 10_000

/**
 * WebSocket subscription service for real-time ERC-8004 event notifications.
 * Subscribes to:
 * - eth_subscribe("logs") filtered to ERC-8004 registry addresses
 * - eth_subscribe("newHeads") for gap detection and completeness
 */
export class WsSubscriptionService {
  private ws: WebSocket | null = null
  private readonly wsUrl: string
  private readonly chainId: number
  private readonly scanner: ScannerService
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly failureWindowMs: number
  private readonly cooldownMs: number
  private readonly onEvent?: (type: string, data: Record<string, unknown>) => void
  private reconnectAttempt: number = 0
  private logsSubId: string | null = null
  private newHeadsSubId: string | null = null
  private running: boolean = false
  private pendingRequests = new Map<number, (result: unknown) => void>()
  private nextId: number = 1
  private notificationQueue: Promise<void> = Promise.resolve()
  private failureWindowStartAtMs: number | null = null
  private consecutiveFailuresInWindow: number = 0
  private cooldownUntilMs: number = 0
  private lastCooldownSkipLogAtMs: number = 0

  constructor(opts: WsSubscriptionOpts) {
    this.wsUrl = opts.wsUrl
    this.chainId = opts.chainId
    this.scanner = opts.scanner
    this.baseDelayMs = opts.baseDelayMs
    this.maxDelayMs = opts.maxDelayMs
    this.failureWindowMs = Number.isFinite(opts.failureWindowMs) ? Math.max(0, opts.failureWindowMs) : 0
    this.cooldownMs = Number.isFinite(opts.cooldownMs) ? Math.max(0, opts.cooldownMs) : 0
    this.onEvent = opts.onEvent
  }

  async start(): Promise<void> {
    this.running = true
    await this.connect()
  }

  stop(): void {
    this.running = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private async connect(): Promise<void> {
    if (!this.running) return

    try {
      this.ws = new WebSocket(this.wsUrl)

      this.ws.on('open', async () => {
        log({ level: 'info', msg: 'WebSocket connected' })
        this.reconnectAttempt = 0

        // Subscribe to logs for both registry addresses
        this.logsSubId = await this.subscribe('logs', {
          address: [
            ERC8004_CONTRACTS.IDENTITY_REGISTRY,
            ERC8004_CONTRACTS.REPUTATION_REGISTRY,
          ],
        })

        // Subscribe to new block heads
        this.newHeadsSubId = await this.subscribe('newHeads', {})

        log({
          level: 'info',
          msg: `Subscribed: logs=${this.logsSubId}, newHeads=${this.newHeadsSubId}`,
        })
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('close', () => {
        log({ level: 'warn', msg: 'WebSocket disconnected' })
        this.logsSubId = null
        this.newHeadsSubId = null
        this.scheduleReconnect()
      })

      this.ws.on('error', (err) => {
        log({ level: 'error', msg: 'WebSocket error', error: err })
      })
    } catch (error) {
      log({ level: 'error', msg: 'WebSocket connect failed', error })
      this.scheduleReconnect()
    }
  }

  private async subscribe(method: string, params: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const request = {
        jsonrpc: '2.0',
        id,
        method: 'eth_subscribe',
        params: Object.keys(params).length > 0 ? [method, params] : [method],
      }

      this.pendingRequests.set(id, (result: unknown) => {
        resolve(result as string)
      })

      this.ws!.send(JSON.stringify(request), (err) => {
        if (err) {
          this.pendingRequests.delete(id)
          reject(err)
        }
      })

      // Timeout for subscription response
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Subscription timeout for ${method}`))
        }
      }, 10000)
    })
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw)

      // Handle subscription responses
      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        const handler = this.pendingRequests.get(msg.id)!
        this.pendingRequests.delete(msg.id)
        handler(msg.result)
        return
      }

      // Handle subscription notifications
      if (msg.method === 'eth_subscription' && msg.params) {
        const subId = msg.params.subscription
        const result = msg.params.result

        this.enqueueNotification(async () => {
          if (subId === this.logsSubId) {
            await this.handleLogNotification(result)
          } else if (subId === this.newHeadsSubId) {
            await this.handleNewHeadNotification(result)
          }
        })
      }
    } catch (error) {
      log({ level: 'error', msg: 'Failed to parse WebSocket message', error })
    }
  }

  private enqueueNotification(task: () => Promise<void>): void {
    this.notificationQueue = this.notificationQueue
      .then(async () => {
        await task()
      })
      .catch((error) => {
        log({ level: 'error', msg: 'Failed to process queued websocket notification', error })
      })
  }

  private shouldPauseProcessing(context: string): boolean {
    if (this.cooldownUntilMs <= 0) return false

    const now = Date.now()
    if (now >= this.cooldownUntilMs) {
      this.cooldownUntilMs = 0
      this.lastCooldownSkipLogAtMs = 0
      log({ level: 'info', msg: 'Scanner RPC cooldown ended; resuming processing' })
      return false
    }

    if (now - this.lastCooldownSkipLogAtMs >= COOLDOWN_SKIP_LOG_INTERVAL_MS) {
      const remainingMs = this.cooldownUntilMs - now
      log({
        level: 'warn',
        msg: `Skipping ${context} while scanner RPC cooldown is active (${Math.ceil(remainingMs / 1000)}s remaining)`,
      })
      this.lastCooldownSkipLogAtMs = now
    }

    return true
  }

  private resetFailureWindow(): void {
    this.failureWindowStartAtMs = null
    this.consecutiveFailuresInWindow = 0
  }

  private onRpcSuccess(): void {
    if (this.failureWindowStartAtMs === null) return
    this.resetFailureWindow()
  }

  private onRpcFailure(context: string): void {
    if (this.failureWindowMs <= 0 || this.cooldownMs <= 0) return

    const now = Date.now()
    if (this.failureWindowStartAtMs === null) {
      this.failureWindowStartAtMs = now
      this.consecutiveFailuresInWindow = 1
      return
    }

    this.consecutiveFailuresInWindow += 1
    const elapsedMs = now - this.failureWindowStartAtMs
    if (elapsedMs < this.failureWindowMs) return

    this.cooldownUntilMs = now + this.cooldownMs
    this.lastCooldownSkipLogAtMs = 0

    log({
      level: 'warn',
      msg: [
        `Entering scanner RPC cooldown for ${this.cooldownMs}ms`,
        `after ${this.consecutiveFailuresInWindow} failures over ${elapsedMs}ms`,
        `while handling ${context}`,
      ].join(' '),
    })

    this.resetFailureWindow()
  }

  private async handleLogNotification(logData: Record<string, unknown>): Promise<void> {
    const txHash = logData.transactionHash as string | undefined
    if (!txHash) return

    if (this.shouldPauseProcessing(`log tx ${txHash}`)) {
      return
    }

    log({ level: 'debug', msg: `Log notification: tx=${txHash}` })

    try {
      await this.scanner.processTransaction(txHash)
      this.onEvent?.('transaction', { chainId: this.chainId, txHash })
    } catch (error) {
      this.onRpcFailure(`log tx ${txHash}`)
      log({ level: 'error', msg: `Failed to process log notification for ${txHash}`, error })
    }
  }

  private async handleNewHeadNotification(head: Record<string, unknown>): Promise<void> {
    const numberHex = head.number as string | undefined
    if (!numberHex) return

    const headNumber = parseInt(numberHex, 16)
    if (this.shouldPauseProcessing(`new head ${headNumber}`)) {
      return
    }

    log({ level: 'debug', msg: `New head: ${headNumber}` })

    try {
      const syncState = await getChainSyncState(this.chainId)
      const lastSynced = syncState?.lastSyncedBlock ?? 0

      // If there's a gap, fill missing blocks
      if (headNumber > lastSynced + 1) {
        await fillGap(this.scanner, this.chainId, lastSynced + 1, headNumber - 1)
      }

      // Process the current head block
      await this.scanner.processBlock(headNumber, { awaitMetadataResolution: true })
      this.onRpcSuccess()
      this.onEvent?.('block_processed', { chainId: this.chainId, blockNumber: headNumber })
    } catch (error) {
      this.onRpcFailure(`new head ${headNumber}`)
      log({ level: 'error', msg: `Failed to handle new head ${headNumber}`, error })
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (!this.running) return

    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.reconnectAttempt),
      this.maxDelayMs,
    )
    this.reconnectAttempt++

    log({ level: 'info', msg: `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})` })
    await sleep(delay)

    if (this.running) {
      // On reconnect, always resume from persisted lastSyncedBlock + 1
      await this.connect()
    }
  }
}
