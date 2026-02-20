import express from 'express'
import cors from 'cors'
import { env } from './env'
import { log } from './utils/logger'
import { MongoPoolManager } from './utils/mongoPoolManager'
import type { MongoConnectionParams } from './utils/mongodb'
import { getChainConfig } from './config/chains'
import { ScannerService } from './services/scanner.service'
import { WsSubscriptionService } from './services/ws-subscription.service'
import { runCatchup } from './services/catchup.service'
import { createHealthRouter } from './controllers/health.controller'
import { createAgentsRouter } from './controllers/agents.controller'
import { createReputationRouter } from './controllers/reputation.controller'
import { createAddressesRouter } from './controllers/addresses.controller'
import { createTransactionsRouter } from './controllers/transactions.controller'
import { createAnalyticsRouter } from './controllers/analytics.controller'
import { createNetworkRouter } from './controllers/network.controller'
import { createSearchRouter } from './controllers/search.controller'
import { createResolveRouter } from './controllers/resolve.controller'
import { setSSEHeaders } from './controllers/helpers'
import type { Request, Response, NextFunction } from 'express'

const app = express()

// --- Middleware ---
app.use(express.json())

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
app.use(cors(corsOptions))

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    log({
      level,
      msg: `${req.method} ${req.originalUrl} ${status} ${duration}ms`,
      meta: {
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

// --- State ---
let scanner: ScannerService | null = null
let wsService: WsSubscriptionService | null = null
let httpServer: ReturnType<typeof app.listen> | null = null
const sseClients: Set<Response> = new Set()

// --- Routes ---
app.use('/v1/health', createHealthRouter(scanner))
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

  // 2. Start Express server immediately so the API is available during sync
  httpServer = app.listen(env.PORT, () => {
    const addr = httpServer!.address()
    const bind = typeof addr === 'string' ? addr : `http://localhost:${addr?.port}`
    log({ level: 'info', msg: `AgentIndex API listening on ${bind}` })
    log({ level: 'info', msg: `CORS allowed origins: ${env.ALLOWED_ORIGINS.join(', ')}` })
    log({ level: 'info', msg: `Scanner enabled: ${env.SCANNER_ENABLED}` })
  })

  // 3. Initialize scanner if enabled (runs in background — API is already serving)
  if (env.SCANNER_ENABLED) {
    try {
      const chainConfig = getChainConfig()

      scanner = new ScannerService({
        chainId: chainConfig.chainId,
        network: chainConfig.network,
        rpcUrl: chainConfig.rpcUrl,
        abiDirectory: env.ABI_DIRECTORY,
        txConcurrency: env.SCANNER_TX_CONCURRENCY,
      })
      await scanner.initialize()

      // Re-register health router with initialized scanner
      // (The initial registration used null scanner)
      app._router.stack = app._router.stack.filter(
        (layer: { route?: { path?: string } }) =>
          !layer.route || !layer.route.path?.startsWith('/v1/health'),
      )
      app.use('/v1/health', createHealthRouter(scanner))

      // Re-register transactions router with decoder access for real-time decode
      app._router.stack = app._router.stack.filter(
        (layer: { route?: { path?: string } }) =>
          !layer.route || !layer.route.path?.startsWith('/v1/transactions'),
      )
      app.use('/v1/transactions', createTransactionsRouter({
        getDecoder: () => { try { return scanner!.getDecoder() } catch { return null } },
        chainId: chainConfig.chainId,
      }))

      // 4. Run catch-up from last synced block to latest
      log({ level: 'info', msg: 'Starting catch-up sync...' })
      const latestBlock = await runCatchup(scanner, chainConfig.chainId, env.CATCHUP_BATCH_SIZE)
      log({ level: 'info', msg: `Catch-up complete. Latest block: ${latestBlock}` })

      // 5. Start WebSocket subscriptions for real-time events
      wsService = new WsSubscriptionService({
        wsUrl: chainConfig.wsUrl,
        chainId: chainConfig.chainId,
        scanner,
        baseDelayMs: env.WS_RECONNECT_BASE_DELAY_MS,
        maxDelayMs: env.WS_RECONNECT_MAX_DELAY_MS,
        onEvent: (type, data) => {
          broadcastSSE(type, data)
        },
      })
      await wsService.start()
      log({ level: 'info', msg: 'WebSocket subscription service started' })
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

    if (wsService) {
      wsService.stop()
      log({ level: 'info', msg: 'WebSocket subscription service stopped' })
    }

    if (sseClients.size > 0) {
      log({ level: 'info', msg: `Closing ${sseClients.size} SSE client(s)` })
      for (const client of sseClients) {
        client.end()
      }
      sseClients.clear()
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
