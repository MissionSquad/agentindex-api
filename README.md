# AgentIndex API

Express + TypeScript blockchain scanner and REST API for the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Agent Registry. Indexes on-chain events into MongoDB and serves them via a queryable API.

## Features

- **Block scanner** — catches up from a configurable start block and processes historical transactions
- **WebSocket subscription** — listens for real-time on-chain events after catch-up
- **EVM decoding** — decodes transaction input/logs via [evmdecoder](https://www.npmjs.com/package/evmdecoder)
- **SSE event stream** — pushes live events to connected clients
- **URI resolution** — proxies HTTP and IPFS agent metadata URIs
- **Persisted agent metadata** — resolves and stores off-chain agent URI metadata for API read paths and filters
- **Optional x402 paywall proxy** — serves paid search/directory endpoints on a dedicated port

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
| `/v1/search/agents` | Structured agent metadata search (skills, tools, services, protocols, contacts, attributes) |
| `/v1/resolve/uri` | Proxy HTTP/IPFS metadata URIs |
| `/v1/resolve/image` | Proxy HTTP/IPFS images |
| `/v1/events/stream` | Server-Sent Events live feed |

## x402 Deployment Model

This service now supports a **dual-port** deployment model:

- **API port (`PORT`, default `3100`)**: normal, unpriced API routes
- **x402 port (`X402_PORT`, default `3101`)**: payment-protected proxy routes only

When `X402_ENABLED=true`, the x402 proxy app enforces payment for:

- `GET /v1/search`
- `GET /v1/search/agents`
- `GET /v1/agents`

Unpriced endpoint behavior:

- `GET /v1/agents/:agentId` remains unpriced on the API port.

Important upstream rule:

- `X402_UPSTREAM_ORIGIN` must point to the **unpriced API origin** (for example `http://127.0.0.1:3100` locally or internal API service URL in production).
- Do not point `X402_UPSTREAM_ORIGIN` at the x402 proxy/public paywalled origin.

Minimal local x402 config example:

```dotenv
X402_ENABLED=true
X402_PORT=3101
X402_DEFAULT_NETWORK=eip155:8453
X402_DEFAULT_PAY_TO=0x...
X402_LEASE_TOKEN_SECRET=<32+ char random secret>
X402_UPSTREAM_ORIGIN=http://127.0.0.1:3100
X402_ALLOW_INSECURE_HTTP_UPSTREAM=true
X402_ALLOW_PRIVATE_IP_UPSTREAMS=true
```

## Search Endpoints

### `GET /v1/search`

Global mixed-entity search that returns `agent`, `address`, `transaction`, `tag`, and `endpoint` hits.

Supported query parameters:
- `q` (required)
- `chainId` (optional)
- `page` (optional, default `1`)
- `limit` (optional, default `25`, max `100`)

Example request:

```bash
curl "http://localhost:3100/v1/search?q=mcp%20portfolio&page=1&limit=10"
```

Example response:

```json
{
  "query": "mcp portfolio",
  "results": {
    "items": [
      {
        "type": "agent",
        "id": "13445",
        "title": "Gekko",
        "subtitle": "Agent 13445",
        "route": "/agents/13445"
      },
      {
        "type": "endpoint",
        "id": "endpoint:https://www.gekkoterminal.xyz/mcp",
        "title": "Endpoint: https://www.gekkoterminal.xyz/mcp",
        "subtitle": "Agent 13445",
        "route": "/reputation?endpoint=https%3A%2F%2Fwww.gekkoterminal.xyz%2Fmcp"
      }
    ],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 2,
      "hasNextPage": false
    }
  }
}
```

### `GET /v1/search/agents`

Structured metadata search over persisted `agent_metadata`. This endpoint is intended for facet-driven UI search.

Supported query parameters:
- Paging/scope: `chainId`, `page`, `limit`, `status` (`resolved` | `failed` | `pending` | `all`)
- Free text: `q` (tokenized against indexed `searchTerms`)
- Boolean filters: `x402Support`, `active`, `includeRaw`
- Service filters: `service`, `endpoint`, `version`, `skill`, `domain`, `tool`, `capability`, `a2aSkill`, `mcpTool`
- Registration filters: `registration`, `registrationRegistry`, `registrationAgentId`
- Attribute filters: `protocol`, `dataFeed`, `tag`, `blockchain`, `attributeChainId`
- Contact filters: `email`, `twitter`
- Other filters: `trust`, `type`, `name`

Notes:
- String filters support comma-separated or repeated query parameters.
- String filters are case-insensitive and matched through indexed `searchTerms`.
- `includeRaw=true` includes full `rawMetadata` per row.

Example request:

```bash
curl "http://localhost:3100/v1/search/agents?q=portfolio%20manager&service=mcp&tool=get_portfolio&protocol=morpho&tag=defi&email=contact@gekkoterminal.ai&x402Support=true&page=1&limit=20"
```

Example response:

```json
{
  "query": "portfolio manager",
  "filters": {
    "status": "resolved",
    "x402Support": true,
    "active": null,
    "service": ["mcp"],
    "endpoint": [],
    "version": [],
    "skill": [],
    "domain": [],
    "tool": ["get_portfolio"],
    "capability": [],
    "a2aSkill": [],
    "mcpTool": [],
    "registration": [],
    "registrationRegistry": [],
    "registrationAgentId": [],
    "trust": [],
    "protocol": ["morpho"],
    "dataFeed": [],
    "tag": ["defi"],
    "blockchain": [],
    "attributeChainId": [],
    "email": ["contact@gekkoterminal.ai"],
    "twitter": [],
    "type": [],
    "name": []
  },
  "results": {
    "items": [
      {
        "chainId": 1,
        "agentId": 13445,
        "uri": "https://www.gekkoterminal.xyz/agent.json",
        "uriHash": "cbf0d2...",
        "name": "Gekko",
        "description": "AI Agent Portfolio Manager...",
        "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        "image": "https://www.gekkoterminal.xyz/gekkoai.jpg",
        "active": true,
        "x402Support": true,
        "erc8004Support": null,
        "services": ["web", "agentWallet", "A2A", "MCP", "email", "twitter"],
        "registrations": ["eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"],
        "supportedTrusts": ["reputation", "crypto-economic"],
        "serviceEntries": [],
        "registrationEntries": [],
        "serviceEndpoints": ["https://www.gekkoterminal.xyz/mcp"],
        "serviceVersions": ["2025-11-25"],
        "serviceSkills": [],
        "serviceDomains": [],
        "serviceTools": ["get_portfolio", "analyze_token"],
        "serviceCapabilities": ["tools", "resources", "prompts"],
        "serviceA2aSkills": ["portfolio_management", "yield_optimization"],
        "serviceMcpTools": ["get_portfolio", "simulate_swap"],
        "registrationRegistries": ["eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"],
        "registrationAgentIds": [13445],
        "attributeProtocols": ["morpho", "yearn"],
        "attributeDataFeeds": ["morpho-api", "yearn-ydaemon"],
        "attributeTags": ["defi", "portfolio-management"],
        "attributeBlockchains": ["base"],
        "attributeChainIds": [8453],
        "contactEmails": ["contact@gekkoterminal.ai"],
        "contactTwitter": ["https://twitter.com/Gekko_Agent"],
        "resolveStatus": "resolved",
        "resolveError": null,
        "resolvedAt": 1770159729000,
        "eventTimestamp": 1770159729000,
        "eventTxHash": "0x...",
        "eventBlockNumber": 12345678
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "hasNextPage": false
    }
  }
}
```

### `GET /v1/agents`

Directory endpoint with list-level search filters and pagination.

Supported search/filter parameters include:
- `protocol` (case-insensitive against persisted service names)
- `x402Support`
- `tag`
- `hasFeedback`
- `hasResponses`
- `hasBeenTransferred`
- `registeredSinceDays`
- `sort` (`newest`, `oldest`, `most-feedback`, `highest-reputation`, `recently-active`)
- `page`, `limit`, `chainId`

Example request:

```bash
curl "http://localhost:3100/v1/agents?protocol=a2a&x402Support=true&sort=most-feedback&page=1&limit=25"
```

Example response:

```json
{
  "items": [
    {
      "chainId": 1,
      "agentId": "6888",
      "ownerAddress": "0x...",
      "originalRegistrant": "0x...",
      "agentUri": "https://minara.ai/agent.json",
      "name": "Minara AI",
      "description": "Intelligent crypto assistant powered by AI.",
      "imageUrl": "https://minara.ai/images/minara-logo-lg.png",
      "tags": [],
      "services": ["A2A", "OASF", "web", "twitter", "email"],
      "x402Support": true,
      "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      "active": true,
      "erc8004Support": null,
      "registrations": ["eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"],
      "supportedTrusts": ["reputation", "crypto-economic", "tee-attestation"],
      "registrationTxHash": "0x...",
      "registrationTimestamp": 1769757405000,
      "hasBeenTransferred": false,
      "transferCount": 0,
      "feedbackCount": 12,
      "responseCount": 7,
      "averageReputation": 4.6,
      "lastActiveTimestamp": 1769760000000
    }
  ],
  "meta": {
    "page": 1,
    "limit": 25,
    "total": 1,
    "hasNextPage": false
  }
}
```

### `GET /v1/agents/:agentId`

Returns a full agent profile with on-chain activity and resolved off-chain metadata.

`resolvedMetadata.links` now provides normalized, clickable contact links extracted from metadata:
- `kind`: `web` | `twitter` | `email`
- `label`: display label
- `href`: safe link target (`https://...` or `mailto:...`)
- `endpoint`: original/normalized endpoint value
- `serviceName`: originating service name when present

Example request:

```bash
curl "http://localhost:3100/v1/agents/6888"
```

Example response excerpt:

```json
{
  "agent": {
    "agentId": "6888",
    "name": "Minara AI"
  },
  "resolvedMetadata": {
    "name": "Minara AI",
    "services": ["A2A", "OASF", "web", "twitter", "email"],
    "links": [
      {
        "kind": "web",
        "label": "minara.ai",
        "href": "https://minara.ai",
        "endpoint": "https://minara.ai",
        "serviceName": "web"
      },
      {
        "kind": "twitter",
        "label": "@minara",
        "href": "https://x.com/minara",
        "endpoint": "https://x.com/minara",
        "serviceName": "twitter"
      },
      {
        "kind": "email",
        "label": "support@minara.ai",
        "href": "mailto:support@minara.ai",
        "endpoint": "support@minara.ai",
        "serviceName": "email"
      }
    ],
    "resolveStatus": "resolved"
  }
}
```

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
| `SCANNER_RESTART_BASE_DELAY_MS` | `5000` | Backoff base before restarting catch-up after a crash |
| `SCANNER_RESTART_MAX_DELAY_MS` | `60000` | Backoff ceiling between catch-up restart attempts |
| `IPFS_GATEWAY_URLS` | `https://ipfs.io/ipfs/|https://cloudflare-ipfs.com/ipfs/|https://dweb.link/ipfs/` | Ordered IPFS gateway list for metadata resolution |
| `METADATA_HTTP_TIMEOUT_MS` | `10000` | HTTP metadata fetch timeout |
| `METADATA_IPFS_TIMEOUT_MS` | `30000` | IPFS gateway fetch timeout per attempt |
| `METADATA_FETCH_RETRIES` | `2` | Retry attempts for HTTP/IPFS metadata fetches |
| `METADATA_RETRY_BASE_DELAY_MS` | `400` | Base retry backoff delay for metadata fetches |
| `METADATA_RETRY_MAX_DELAY_MS` | `5000` | Max retry backoff delay for metadata fetches |
| `METADATA_FETCH_CONCURRENCY` | `8` | Concurrent metadata resolution limit |
| `METADATA_IGNORED_URI_PREFIXES` | `https://ag0.xyz` | Pipe-delimited URI prefixes to skip during metadata resolution/retry |
| `METADATA_RE_RESOLVE_INTERVAL_MS` | `3600000` | Periodic stale metadata re-resolution interval |
| `METADATA_RE_RESOLVE_MAX_AGE_MS` | `86400000` | Age threshold before HTTP/IPFS metadata is re-resolved |
| `METADATA_RE_RESOLVE_BATCH_SIZE` | `50` | Max stale metadata records per re-resolution cycle |
| `METADATA_RETRY_INTERVAL_MS` | `900000` | Interval for retrying failed metadata resolutions |
| `METADATA_RETRY_MAX_AGE_MS` | `900000` | Age threshold before retrying failed metadata resolutions |
| `METADATA_RETRY_BATCH_SIZE` | `20` | Max failed metadata records per retry cycle |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Pipe-delimited CORS origins |
| `X402_ENABLED` | `false` | Enable/disable x402 proxy app |
| `X402_PORT` | `3101` | x402 proxy listen port (separate from main API port) |
| `X402_DEFAULT_NETWORK` | `eip155:8453` | Default x402 CAIP-2 network (`eip155:*` or `solana:*`) |
| `X402_DEFAULT_PAY_TO` | — | Required recipient address when `X402_ENABLED=true` |
| `X402_LEASE_TOKEN_SECRET` | — | Required x402 lease token secret; minimum length `32` |
| `X402_FACILITATOR_URL` | — | Optional facilitator URL override |
| `X402_FACILITATOR_BEARER` | — | Optional facilitator bearer token |
| `X402_SYNC_FACILITATOR_ON_START` | `true` | Sync facilitator route metadata during startup |
| `X402_UPSTREAM_ORIGIN` | `http://127.0.0.1:3100` | Unpriced API origin used by x402 proxy upstream requests |
| `X402_ALLOW_INSECURE_HTTP_UPSTREAM` | `false` | Allow `http://` upstream targets (set `true` for localhost dev upstreams) |
| `X402_ALLOW_PRIVATE_IP_UPSTREAMS` | `false` | Allow private/localhost upstream targets (set `true` for localhost dev upstreams) |
| `ABI_DIRECTORY` | — | Custom ABI directory for evmdecoder |

## Scripts

```bash
yarn dev           # Start dev server (ts-node-dev with auto-reload)
yarn lint          # TypeScript type check (tsc --noEmit)
yarn test          # Run tests (vitest)
yarn test:x402     # Validate x402 unpaid flow (+ optional paid replay via PAYMENT_SIGNATURE)
yarn test:watch    # Run tests in watch mode
yarn test:coverage # Run tests with coverage
yarn backfill:metadata     # Backfill persisted agent metadata
yarn backfill:metadata:dry # Dry-run metadata backfill
yarn backfill:metadata:retry # Retry failed metadata backfill entries
yarn backfill:metadata:force # Include already-resolved agents in the run
yarn backfill:metadata:reprocess # Re-fetch/re-extract all candidates (refresh indexed facets)
yarn build         # Compile TypeScript to lib/
yarn start         # Run compiled output (node lib/index.js)
```

### x402 Test Script

`yarn test:x402` runs `scripts/test-x402-payments.sh` and writes artifacts to `tmp/x402-test-<timestamp>/`.

Default targets:

- `API_BASE=http://127.0.0.1:3100`
- `X402_BASE=http://127.0.0.1:3101`

Behavior:

- Confirms x402 endpoints return `402` with `PAYMENT-REQUIRED` when unpaid.
- Confirms same paths on `API_BASE` are not paywalled.
- If `PAYMENT_SIGNATURE` is provided, sends a paid replay request and validates non-`402` response.

Example:

```bash
PAYMENT_SIGNATURE="<payment-signature-header-value>" yarn test:x402
```

## Docker

```bash
docker build -t agentindex-api .
docker run -p 3100:3100 -p 3101:3101 --env-file .env agentindex-api
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
- **x402 proxy app** — separate Express app on `X402_PORT` that serves only payment-protected search/directory routes
