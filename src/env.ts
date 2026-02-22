import dotenv from 'dotenv'

dotenv.config()

const port = parseInt(process.env.PORT || '3100', 10)
const x402Port = parseInt(process.env.X402_PORT || String(port + 1), 10)

export const env = {
  PORT: port,

  // MongoDB
  MONGO_USER: process.env.MONGO_USER || 'root',
  MONGO_PASS: process.env.MONGO_PASS || 'example',
  MONGO_HOST: process.env.MONGO_HOST || 'localhost:27017',
  MONGO_DBNAME: process.env.MONGO_DBNAME || 'agentindex',
  MONGO_REPLICASET: process.env.MONGO_REPLICASET || undefined,
  MONGO_CONNECT_TIMEOUT_MS: parseInt(process.env.MONGO_CONNECT_TIMEOUT_MS || '10000', 10),
  MONGO_SOCKET_TIMEOUT_MS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS || '45000', 10),
  MAX_MONGO_CONNECT_RETRIES: parseInt(process.env.MAX_MONGO_CONNECT_RETRIES || '5', 10),
  MONGO_CONNECT_BASE_DELAY_MS: parseInt(process.env.MONGO_CONNECT_BASE_DELAY_MS || '1000', 10),
  MONGO_MAX_POOL_SIZE: parseInt(process.env.MONGO_MAX_POOL_SIZE || '50', 10),
  MONGO_MIN_POOL_SIZE: parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),

  // Ethereum RPC
  ETH_RPC_URL: process.env.ETH_RPC_URL || '',
  ETH_WS_URL: process.env.ETH_WS_URL || '',

  // Chain
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '1', 10),
  NETWORK_NAME: process.env.NETWORK_NAME || 'mainnet',

  // Scanner
  SCANNER_START_BLOCK: parseInt(process.env.SCANNER_START_BLOCK || '0', 10),
  SCANNER_ENABLED: /true/i.test(process.env.SCANNER_ENABLED ?? 'true'),
  CATCHUP_BATCH_SIZE: parseInt(process.env.CATCHUP_BATCH_SIZE || '10', 10),
  SCANNER_TX_CONCURRENCY: parseInt(process.env.SCANNER_TX_CONCURRENCY || '8', 10),
  SCANNER_FAILURE_WINDOW_MS: parseInt(process.env.SCANNER_FAILURE_WINDOW_MS || '300000', 10),
  SCANNER_COOLDOWN_MS: parseInt(process.env.SCANNER_COOLDOWN_MS || '60000', 10),
  WS_RECONNECT_BASE_DELAY_MS: parseInt(process.env.WS_RECONNECT_BASE_DELAY_MS || '1000', 10),
  WS_RECONNECT_MAX_DELAY_MS: parseInt(process.env.WS_RECONNECT_MAX_DELAY_MS || '30000', 10),

  // Metadata resolution
  IPFS_GATEWAY_URLS: (
    process.env.IPFS_GATEWAY_URLS
    || 'https://ipfs.io/ipfs/|https://cloudflare-ipfs.com/ipfs/|https://dweb.link/ipfs/'
  )
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
  METADATA_HTTP_TIMEOUT_MS: parseInt(process.env.METADATA_HTTP_TIMEOUT_MS || '10000', 10),
  METADATA_IPFS_TIMEOUT_MS: parseInt(process.env.METADATA_IPFS_TIMEOUT_MS || '30000', 10),
  METADATA_FETCH_RETRIES: parseInt(process.env.METADATA_FETCH_RETRIES || '2', 10),
  METADATA_RETRY_BASE_DELAY_MS: parseInt(process.env.METADATA_RETRY_BASE_DELAY_MS || '400', 10),
  METADATA_RETRY_MAX_DELAY_MS: parseInt(process.env.METADATA_RETRY_MAX_DELAY_MS || '5000', 10),
  METADATA_FETCH_CONCURRENCY: parseInt(process.env.METADATA_FETCH_CONCURRENCY || '8', 10),
  METADATA_IGNORED_URI_PREFIXES: (process.env.METADATA_IGNORED_URI_PREFIXES || 'https://ag0.xyz')
    .split('|')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
  METADATA_RE_RESOLVE_INTERVAL_MS: parseInt(process.env.METADATA_RE_RESOLVE_INTERVAL_MS || '3600000', 10),
  METADATA_RE_RESOLVE_MAX_AGE_MS: parseInt(process.env.METADATA_RE_RESOLVE_MAX_AGE_MS || '86400000', 10),
  METADATA_RE_RESOLVE_BATCH_SIZE: parseInt(process.env.METADATA_RE_RESOLVE_BATCH_SIZE || '50', 10),
  METADATA_RETRY_INTERVAL_MS: parseInt(process.env.METADATA_RETRY_INTERVAL_MS || '900000', 10),
  METADATA_RETRY_MAX_AGE_MS: parseInt(process.env.METADATA_RETRY_MAX_AGE_MS || '900000', 10),
  METADATA_RETRY_BATCH_SIZE: parseInt(process.env.METADATA_RETRY_BATCH_SIZE || '20', 10),

  // CORS
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split('|').map((u) => u.trim()),

  // x402
  X402_ENABLED: /true/i.test(process.env.X402_ENABLED ?? 'false'),
  X402_PORT: x402Port,
  X402_DEFAULT_NETWORK: process.env.X402_DEFAULT_NETWORK || 'eip155:8453',
  X402_DEFAULT_PAY_TO: process.env.X402_DEFAULT_PAY_TO || '',
  X402_LEASE_TOKEN_SECRET: process.env.X402_LEASE_TOKEN_SECRET || '',
  X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL || undefined,
  X402_FACILITATOR_BEARER: process.env.X402_FACILITATOR_BEARER || undefined,
  X402_SYNC_FACILITATOR_ON_START: /true/i.test(process.env.X402_SYNC_FACILITATOR_ON_START ?? 'true'),
  X402_UPSTREAM_ORIGIN: process.env.X402_UPSTREAM_ORIGIN || `http://127.0.0.1:${port}`,
  X402_ALLOW_INSECURE_HTTP_UPSTREAM: /true/i.test(process.env.X402_ALLOW_INSECURE_HTTP_UPSTREAM ?? 'false'),
  X402_ALLOW_PRIVATE_IP_UPSTREAMS: /true/i.test(process.env.X402_ALLOW_PRIVATE_IP_UPSTREAMS ?? 'false'),

  // ABI directory for evmdecoder
  ABI_DIRECTORY: process.env.ABI_DIRECTORY || undefined,
}
