import dotenv from 'dotenv'

dotenv.config()

export const env = {
  PORT: parseInt(process.env.PORT || '3100', 10),

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
  WS_RECONNECT_BASE_DELAY_MS: parseInt(process.env.WS_RECONNECT_BASE_DELAY_MS || '1000', 10),
  WS_RECONNECT_MAX_DELAY_MS: parseInt(process.env.WS_RECONNECT_MAX_DELAY_MS || '30000', 10),

  // CORS
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split('|').map((u) => u.trim()),

  // ABI directory for evmdecoder
  ABI_DIRECTORY: process.env.ABI_DIRECTORY || undefined,
}
