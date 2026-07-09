import express from 'express'
import cors from 'cors'
import { createX402ProxySdk } from '@missionsquad/x402-proxy'
import { createPaywall, evmPaywall } from '@x402/paywall'
import { WebSocketServer, WebSocket } from 'ws'
import { env } from './env'
import { log } from './utils/logger'
import { MongoPoolManager } from './utils/mongoPoolManager'
import type { MongoConnectionParams } from './utils/mongodb'
import { getChainConfig, type ChainConfig } from './config/chains'
import { buildSearchX402Endpoints } from './config/x402-search'
import { ScannerService } from './services/scanner.service'
import { WsSubscriptionService } from './services/ws-subscription.service'
import { runCatchupWithRestart } from './services/catchup.service'
import { reResolveStaleMetadata, retryFailedResolutions } from './services/agent-metadata.service'
import { createHealthRouter } from './controllers/health.controller'
import type { CachedLatestBlock } from './controllers/health.controller'
import { createAgentsRouter } from './controllers/agents.controller'
import { createReputationRouter } from './controllers/reputation.controller'
import { createAddressesRouter } from './controllers/addresses.controller'
import { createTransactionsRouter } from './controllers/transactions.controller'
import { createAnalyticsRouter } from './controllers/analytics.controller'
import { createNetworkRouter } from './controllers/network.controller'
import { createSearchRouter } from './controllers/search.controller'
import { createResolveRouter } from './controllers/resolve.controller'
import { setSSEHeaders } from './controllers/helpers'
import { toDashboardActivityItems } from './services/dashboard-activity.service'
import type { DashboardActivityStreamMessage } from './types/api'
import type { EventFact } from './types/mongo'
import type { Express, Request, Response, NextFunction } from 'express'

const app = express()
const x402App = env.X402_ENABLED ? express() : null
type X402Network = `${string}:${string}`

function isX402Network(value: string): value is X402Network {
  return /^(eip155|solana):[A-Za-z0-9]+$/.test(value)
}

function parseX402Network(value: string): X402Network {
  const normalized = value.trim()
  if (!isX402Network(normalized)) {
    throw new Error('X402_DEFAULT_NETWORK must match eip155:* or solana:* when X402_ENABLED=true')
  }
  return normalized
}

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || env.ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`Not allowed by CORS: Origin='${origin}'`))
    }
  },
  credentials: true,
}

function applySharedMiddleware(targetApp: Express, service: 'api' | 'x402'): void {
  targetApp.use(express.json())
  targetApp.use(cors(corsOptions))

  // Request logging middleware
  targetApp.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      const status = res.statusCode
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
      log({
        level,
        msg: `[${service}] ${req.method} ${req.originalUrl} ${status} ${duration}ms`,
        meta: {
          service,
          method: req.method,
          path: req.originalUrl,
          status,
          duration,
          ip: req.ip,
        },
      })
    })

    next()
  })
}

// --- Middleware ---
applySharedMiddleware(app, 'api')
if (x402App) {
  applySharedMiddleware(x402App, 'x402')
}

// --- State ---
let scanner: ScannerService | null = null
let wsService: WsSubscriptionService | null = null
let scannerStopping = false
let httpServer: ReturnType<typeof app.listen> | null = null
let x402HttpServer: ReturnType<typeof app.listen> | null = null
let reResolveTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setInterval> | null = null
let rpcHeartbeatTimer: ReturnType<typeof setInterval> | null = null
let rpcHeartbeatInFlight = false
let latestBlockCache: CachedLatestBlock | null = null
const sseClients: Set<Response> = new Set()
let dashboardWsServer: WebSocketServer | null = null
let dashboardWsHeartbeatTimer: ReturnType<typeof setInterval> | null = null
const dashboardWsClients: Set<WebSocket> = new Set()
const dashboardWsLastPongAt: Map<WebSocket, number> = new Map()

const DASHBOARD_ACTIVITY_WS_PATH = '/v1/ws/dashboard-activity'
const DASHBOARD_WS_PING_INTERVAL_MS = 25_000
const DASHBOARD_WS_STALE_TIMEOUT_MS = 60_000

// --- x402 Routes ---
if (x402App) {
  const defaultPayTo = env.X402_DEFAULT_PAY_TO.trim()
  if (defaultPayTo.length === 0) {
    throw new Error('X402_DEFAULT_PAY_TO is required when X402_ENABLED=true')
  }

  if (env.X402_LEASE_TOKEN_SECRET.length < 32) {
    throw new Error('X402_LEASE_TOKEN_SECRET must be at least 32 characters when X402_ENABLED=true')
  }

  const defaultNetwork = parseX402Network(env.X402_DEFAULT_NETWORK)

  const x402 = createX402ProxySdk({
    defaultNetwork,
    defaultPayTo,
    leaseTokenSecret: env.X402_LEASE_TOKEN_SECRET,
    facilitator: env.X402_FACILITATOR_URL
      ? {
        url: env.X402_FACILITATOR_URL,
        authorizationBearer: env.X402_FACILITATOR_BEARER,
      }
      : undefined,
    security: {
      allowInsecureHttpUpstream: env.X402_ALLOW_INSECURE_HTTP_UPSTREAM,
      allowPrivateIpUpstreams: env.X402_ALLOW_PRIVATE_IP_UPSTREAMS,
    },
    syncFacilitatorOnStart: env.X402_SYNC_FACILITATOR_ON_START,
    endpoints: buildSearchX402Endpoints(env.X402_UPSTREAM_ORIGIN),
    // Full wallet-connect payment UI for browsers hitting protected endpoints
    // (connect wallet, pay in USDC, auto-retry with the payment header). Without
    // a provider, @x402/core serves its bare "Payment Required" fallback page.
    // testnet mode is derived from defaultNetwork by x402-proxy.
    paywall: createPaywall().withNetwork(evmPaywall).build(),
    paywallConfig: { appName: 'AgentIndex' },
  })

  x402.install(x402App)
}

// --- API Routes ---
app.use('/v1/health', createHealthRouter(null))
app.use('/v1/agents', createAgentsRouter())
app.use('/v1/reputation', createReputationRouter())
app.use('/v1/address', createAddressesRouter())
app.use('/v1/transactions', createTransactionsRouter())
app.use('/v1/analytics', createAnalyticsRouter())
app.use('/v1/network', createNetworkRouter())
app.use('/v1/search', createSearchRouter())
app.use('/v1/resolve', createResolveRouter())

// SSE endpoint for live event feed
app.get('/v1/events/stream', (req: Request, res: Response) => {
  setSSEHeaders(res)
  res.write('data: {"type":"connected"}\n\n')

  sseClients.add(res)

  req.on('close', () => {
    sseClients.delete(res)
  })
})

// Broadcast an event to all SSE clients
function broadcastSSE(type: string, data: Record<string, unknown>): void {
  const payload = JSON.stringify({ type, data, timestamp: Date.now() })
  for (const client of sseClients) {
    client.write(`data: ${payload}\n\n`)
  }
}

function removeDashboardWsClient(client: WebSocket): void {
  dashboardWsClients.delete(client)
  dashboardWsLastPongAt.delete(client)
}

function broadcastDashboardWs(message: DashboardActivityStreamMessage): void {
  const payload = JSON.stringify(message)
  for (const client of dashboardWsClients) {
    if (client.readyState !== WebSocket.OPEN) {
      removeDashboardWsClient(client)
      continue
    }

    try {
      client.send(payload)
    } catch (error) {
      log({ level: 'warn', msg: 'Failed to send dashboard websocket message', error })
      removeDashboardWsClient(client)
      client.terminate()
    }
  }
}

async function publishDashboardActivityFromPersistedEventFacts(eventFacts: EventFact[]): Promise<void> {
  const activityItems = await toDashboardActivityItems(eventFacts)
  for (const item of activityItems) {
    broadcastDashboardWs({
      type: 'activity',
      item,
    })
  }
}

function startDashboardWsServer(server: ReturnType<typeof app.listen>): void {
  dashboardWsServer = new WebSocketServer({
    server,
    path: DASHBOARD_ACTIVITY_WS_PATH,
  })

  dashboardWsServer.on('connection', (client) => {
    dashboardWsClients.add(client)
    dashboardWsLastPongAt.set(client, Date.now())

    client.on('pong', () => {
      dashboardWsLastPongAt.set(client, Date.now())
    })

    client.on('close', () => {
      removeDashboardWsClient(client)
    })

    client.on('error', (error) => {
      log({ level: 'warn', msg: 'Dashboard websocket client error', error })
      removeDashboardWsClient(client)
    })

    const connectedPayload: DashboardActivityStreamMessage = {
      type: 'connected',
      timestamp: Date.now(),
    }

    try {
      client.send(JSON.stringify(connectedPayload))
    } catch (error) {
      log({ level: 'warn', msg: 'Failed to send dashboard websocket connected payload', error })
      removeDashboardWsClient(client)
      client.terminate()
    }
  })

  dashboardWsHeartbeatTimer = setInterval(() => {
    const now = Date.now()

    for (const client of dashboardWsClients) {
      const lastPongAt = dashboardWsLastPongAt.get(client) ?? 0
      if (now - lastPongAt > DASHBOARD_WS_STALE_TIMEOUT_MS) {
        removeDashboardWsClient(client)
        client.terminate()
        continue
      }

      if (client.readyState !== WebSocket.OPEN) {
        removeDashboardWsClient(client)
        continue
      }

      try {
        client.ping()
      } catch (error) {
        log({ level: 'warn', msg: 'Failed to ping dashboard websocket client', error })
        removeDashboardWsClient(client)
        client.terminate()
      }
    }
  }, DASHBOARD_WS_PING_INTERVAL_MS)
}

async function stopDashboardWsServer(): Promise<void> {
  if (dashboardWsHeartbeatTimer) {
    clearInterval(dashboardWsHeartbeatTimer)
    dashboardWsHeartbeatTimer = null
  }

  for (const client of dashboardWsClients) {
    removeDashboardWsClient(client)
    client.terminate()
  }

  if (!dashboardWsServer) return

  const wsServer = dashboardWsServer
  dashboardWsServer = null
  await new Promise<void>((resolve) => {
    wsServer.close(() => {
      resolve()
    })
  })
}

// --- Scanner sync supervisor ---
// Drives catch-up sync and, once caught up, the real-time WebSocket subscriptions.
// Catch-up can crash mid-sync (e.g. a sustained RPC outage that exhausts the
// per-request retries). Because progress is checkpointed per block, we wait and
// restart from the persisted block instead of giving up — block sync keeps
// retrying rather than stopping for good. The WS path self-heals on its own
// (reconnect + RPC cooldown), so it is started once after catch-up succeeds.
async function startScannerSyncWithRestart(
  scannerService: ScannerService,
  chainConfig: ChainConfig,
): Promise<void> {
  const latestBlock = await runCatchupWithRestart(
    scannerService,
    chainConfig.chainId,
    env.CATCHUP_BATCH_SIZE,
    {
      baseDelayMs: env.SCANNER_RESTART_BASE_DELAY_MS,
      maxDelayMs: env.SCANNER_RESTART_MAX_DELAY_MS,
      shouldStop: () => scannerStopping,
    },
  )

  // latestBlock is null only when shutdown interrupted catch-up before it completed.
  if (scannerStopping || latestBlock === null) return

  // Real-time subscriptions for ongoing blocks/logs.
  wsService = new WsSubscriptionService({
    wsUrl: chainConfig.wsUrl,
    chainId: chainConfig.chainId,
    scanner: scannerService,
    baseDelayMs: env.WS_RECONNECT_BASE_DELAY_MS,
    maxDelayMs: env.WS_RECONNECT_MAX_DELAY_MS,
    failureWindowMs: env.SCANNER_FAILURE_WINDOW_MS,
    cooldownMs: env.SCANNER_COOLDOWN_MS,
    onEvent: (type, data) => {
      broadcastSSE(type, data)
    },
  })
  await wsService.start()
  log({ level: 'info', msg: 'WebSocket subscription service started' })

  reResolveTimer = setInterval(async () => {
    try {
      const count = await reResolveStaleMetadata(
        chainConfig.chainId,
        env.METADATA_RE_RESOLVE_MAX_AGE_MS,
        env.METADATA_RE_RESOLVE_BATCH_SIZE,
      )
      if (count > 0) {
        log({ level: 'info', msg: `Re-resolved ${count} stale agent metadata entries` })
      }
    } catch (error) {
      log({ level: 'error', msg: 'Periodic metadata re-resolution failed', error })
    }
  }, env.METADATA_RE_RESOLVE_INTERVAL_MS)

  retryTimer = setInterval(async () => {
    try {
      const count = await retryFailedResolutions(
        chainConfig.chainId,
        env.METADATA_RETRY_MAX_AGE_MS,
        env.METADATA_RETRY_BATCH_SIZE,
      )
      if (count > 0) {
        log({ level: 'info', msg: `Retried ${count} failed metadata resolutions` })
      }
    } catch (error) {
      log({ level: 'error', msg: 'Failed metadata retry job error', error })
    }
  }, env.METADATA_RETRY_INTERVAL_MS)
}

// --- Startup ---
async function startServer(): Promise<void> {
  // 1. Initialize MongoDB
  const mongoParams: MongoConnectionParams = {
    user: env.MONGO_USER,
    pass: env.MONGO_PASS,
    host: env.MONGO_HOST,
    db: env.MONGO_DBNAME,
    replicaSet: env.MONGO_REPLICASET,
  }
  MongoPoolManager.initialize(mongoParams)
  log({ level: 'info', msg: 'MongoDB connection pool initialized' })

  // 2. Start API server immediately so data endpoints are available during sync
  httpServer = app.listen(env.PORT, () => {
    const addr = httpServer!.address()
    const bind = typeof addr === 'string' ? addr : `http://localhost:${addr?.port}`
    log({ level: 'info', msg: `AgentIndex API listening on ${bind}` })
    log({ level: 'info', msg: `CORS allowed origins: ${env.ALLOWED_ORIGINS.join(', ')}` })
    log({ level: 'info', msg: `Scanner enabled: ${env.SCANNER_ENABLED}` })
  })
  startDashboardWsServer(httpServer)

  // 3. Start x402 proxy server on a separate port when enabled
  if (x402App) {
    x402HttpServer = x402App.listen(env.X402_PORT, () => {
      const addr = x402HttpServer!.address()
      const bind = typeof addr === 'string' ? addr : `http://localhost:${addr?.port}`
      log({ level: 'info', msg: `x402 proxy listening on ${bind}` })
      log({ level: 'info', msg: `x402 upstream origin: ${env.X402_UPSTREAM_ORIGIN}` })
    })
  } else {
    log({ level: 'info', msg: 'x402 proxy disabled' })
  }

  // 4. Initialize scanner if enabled (runs in background — API is already serving)
  if (env.SCANNER_ENABLED) {
    try {
      const chainConfig = getChainConfig()

      scanner = new ScannerService({
        chainId: chainConfig.chainId,
        network: chainConfig.network,
        rpcUrl: chainConfig.rpcUrl,
        abiDirectory: env.ABI_DIRECTORY,
        txConcurrency: env.SCANNER_TX_CONCURRENCY,
        rpcTimeoutMs: env.ETH_RPC_TIMEOUT_MS,
        freeSocketTimeoutMs: env.ETH_RPC_FREE_SOCKET_TIMEOUT_MS,
        onEventFactsPersisted: (eventFacts) => {
          void publishDashboardActivityFromPersistedEventFacts(eventFacts).catch((error) => {
            log({ level: 'warn', msg: 'Failed to publish dashboard activity websocket events', error })
          })
        },
      })
      await scanner.initialize()

      // Re-register health router with the latest-block cache accessor
      // (The initial registration had no cache to read from)
      app._router.stack = app._router.stack.filter(
        (layer: { route?: { path?: string } }) =>
          !layer.route || !layer.route.path?.startsWith('/v1/health'),
      )
      app.use('/v1/health', createHealthRouter(() => latestBlockCache))

      // RPC heartbeat: refreshes the latest-block cache and, by polling more
      // often than the keep-alive idle timeouts, keeps one warm persistent
      // connection to the RPC node. New-connection churn is what trips stateful
      // middleboxes between this container and the node, so the connection must
      // never sit idle long enough to be torn down.
      const runRpcHeartbeat = async (): Promise<void> => {
        if (rpcHeartbeatInFlight) return
        rpcHeartbeatInFlight = true
        try {
          const value = await scanner!.getLatestBlockNumber()
          latestBlockCache = { value, at: Date.now() }
        } catch (error) {
          log({ level: 'warn', msg: 'RPC heartbeat failed to fetch latest block', error })
        } finally {
          rpcHeartbeatInFlight = false
        }
      }
      void runRpcHeartbeat()
      rpcHeartbeatTimer = setInterval(() => {
        void runRpcHeartbeat()
      }, env.ETH_RPC_HEARTBEAT_INTERVAL_MS)

      // Re-register transactions router with decoder access for real-time decode
      app._router.stack = app._router.stack.filter(
        (layer: { route?: { path?: string } }) =>
          !layer.route || !layer.route.path?.startsWith('/v1/transactions'),
      )
      app.use('/v1/transactions', createTransactionsRouter({
        getDecoder: () => { try { return scanner!.getDecoder() } catch { return null } },
        chainId: chainConfig.chainId,
      }))

      // 5. Run catch-up + real-time sync in the background, restarting on crash.
      //    Detached so a long-running (or repeatedly retrying) catch-up never
      //    blocks startup — the API is already serving above.
      void startScannerSyncWithRestart(scanner, chainConfig).catch((error) => {
        log({ level: 'error', msg: 'Scanner sync supervisor exited unexpectedly', error })
      })
    } catch (error) {
      log({ level: 'error', msg: 'Scanner initialization failed', error })
      log({ level: 'warn', msg: 'API will run without scanner. Existing data remains queryable.' })
    }
  } else {
    log({ level: 'info', msg: 'Scanner disabled. API-only mode.' })
  }
}

// --- Graceful Shutdown ---
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT']
signals.forEach((signal) => {
  process.on(signal, async () => {
    log({ level: 'info', msg: `Received ${signal}. Starting graceful shutdown...` })

    // Stop the catch-up restart loop from scheduling further attempts.
    scannerStopping = true

    if (wsService) {
      wsService.stop()
      log({ level: 'info', msg: 'WebSocket subscription service stopped' })
    }

    if (reResolveTimer !== null) {
      clearInterval(reResolveTimer)
      reResolveTimer = null
    }

    if (retryTimer !== null) {
      clearInterval(retryTimer)
      retryTimer = null
    }

    if (rpcHeartbeatTimer !== null) {
      clearInterval(rpcHeartbeatTimer)
      rpcHeartbeatTimer = null
    }

    if (sseClients.size > 0) {
      log({ level: 'info', msg: `Closing ${sseClients.size} SSE client(s)` })
      for (const client of sseClients) {
        client.end()
      }
      sseClients.clear()
    }

    await stopDashboardWsServer()

    if (x402HttpServer) {
      await new Promise<void>((resolve) => {
        x402HttpServer!.close(() => {
          log({ level: 'info', msg: 'x402 proxy stopped accepting new connections' })
          resolve()
        })
      })
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer!.close(() => {
          log({ level: 'info', msg: 'HTTP server stopped accepting new connections' })
          resolve()
        })
      })
    }

    try {
      await MongoPoolManager.getInstance().close()
    } catch (error) {
      log({ level: 'error', msg: 'Error closing MongoDB', error })
    }

    log({ level: 'info', msg: 'Shutdown complete' })
    process.exit(0)
  })
})

startServer()
