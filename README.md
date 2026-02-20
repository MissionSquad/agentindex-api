# AgentIndex API

Express + TypeScript blockchain scanner and REST API for the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Agent Registry. Indexes on-chain events into MongoDB and serves them via a queryable API.

## Features

- **Block scanner** — catches up from a configurable start block and processes historical transactions
- **WebSocket subscription** — listens for real-time on-chain events after catch-up
- **EVM decoding** — decodes transaction input/logs via [evmdecoder](https://www.npmjs.com/package/evmdecoder)
- **SSE event stream** — pushes live events to connected clients
- **URI resolution** — proxies HTTP and IPFS agent metadata URIs

## Prerequisites

- Node.js >= 22
- Yarn 1.x
- MongoDB 6+
- Ethereum JSON-RPC and WebSocket endpoints

## API Endpoints

All endpoints are read-only (GET).

| Endpoint | Description |
|----------|-------------|
| `/v1/health` | Health check and scanner status |
| `/v1/agents` | Paginated agent registry with filters |
| `/v1/agents/:agentId` | Agent profile and metadata |
| `/v1/reputation` | Global feedback and response activity |
| `/v1/reputation/:agentId` | Agent-scoped reputation data |
| `/v1/address/:address` | Wallet-centric activity profile |
| `/v1/transactions/:txHash` | Decoded transaction detail |
| `/v1/analytics/overview` | Ecosystem metrics and heuristics |
| `/v1/network/graph` | Trust network graph data |
| `/v1/search` | Global search (agents, addresses, tx hashes, tags, endpoints) |
| `/v1/resolve/uri` | Proxy HTTP/IPFS metadata URIs |
| `/v1/resolve/image` | Proxy HTTP/IPFS images |
| `/v1/events/stream` | Server-Sent Events live feed |

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | HTTP listen port |
| `MONGO_USER` | `root` | MongoDB username |
| `MONGO_PASS` | `example` | MongoDB password |
| `MONGO_HOST` | `localhost:27017` | MongoDB host:port |
| `MONGO_DBNAME` | `agentindex` | Database name |
| `MONGO_REPLICASET` | — | Replica set name (omit for standalone) |
| `MONGO_CONNECT_TIMEOUT_MS` | `10000` | Connection timeout |
| `MONGO_SOCKET_TIMEOUT_MS` | `45000` | Socket timeout |
| `MAX_MONGO_CONNECT_RETRIES` | `5` | Max connection retries |
| `MONGO_CONNECT_BASE_DELAY_MS` | `1000` | Retry backoff base delay |
| `MONGO_MAX_POOL_SIZE` | `50` | Max connection pool size |
| `MONGO_MIN_POOL_SIZE` | `5` | Min connection pool size |
| `ETH_RPC_URL` | — | Ethereum JSON-RPC endpoint |
| `ETH_WS_URL` | — | Ethereum WebSocket endpoint |
| `CHAIN_ID` | `1` | Target chain ID |
| `NETWORK_NAME` | `mainnet` | Network label |
| `SCANNER_START_BLOCK` | `0` | Block to begin scanning from |
| `SCANNER_ENABLED` | `true` | Enable/disable the blockchain scanner |
| `CATCHUP_BATCH_SIZE` | `10` | Blocks per catch-up batch |
| `SCANNER_TX_CONCURRENCY` | `8` | Concurrent transaction processing limit |
| `WS_RECONNECT_BASE_DELAY_MS` | `1000` | WebSocket reconnect backoff base |
| `WS_RECONNECT_MAX_DELAY_MS` | `30000` | WebSocket reconnect backoff ceiling |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Pipe-delimited CORS origins |
| `ABI_DIRECTORY` | — | Custom ABI directory for evmdecoder |

## Scripts

```bash
yarn dev           # Start dev server (ts-node-dev with auto-reload)
yarn lint          # TypeScript type check (tsc --noEmit)
yarn test          # Run tests (vitest)
yarn test:watch    # Run tests in watch mode
yarn test:coverage # Run tests with coverage
yarn build         # Compile TypeScript to lib/
yarn start         # Run compiled output (node lib/index.js)
```

## Docker

```bash
docker build -t agentindex-api .
docker run -p 3100:3100 --env-file .env agentindex-api
```

## Architecture

```
src/
├── controllers/     # Express route handlers
├── services/        # Business logic (scanner, analytics, catchup, ws-subscription)
├── repositories/    # MongoDB data access layer
├── config/          # Chain configuration
├── utils/           # Logger, MongoDB pool manager, helpers
├── env.ts           # Environment variable parsing
└── index.ts         # Express app setup, startup, graceful shutdown
```

- **Scanner service** — initializes evmdecoder, processes blocks, extracts ERC-8004 events
- **Catchup service** — replays historical blocks in batches from last synced block to chain head
- **WS subscription service** — subscribes to new blocks via WebSocket with exponential backoff reconnect
- **Repository layer** — typed MongoDB clients for events, transactions, and graph edges
