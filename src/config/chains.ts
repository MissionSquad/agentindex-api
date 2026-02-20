import { env } from '../env'

export interface ChainConfig {
  chainId: number
  network: string
  rpcUrl: string
  wsUrl: string
}

export function getChainConfig(): ChainConfig {
  if (!env.ETH_RPC_URL) {
    throw new Error('ETH_RPC_URL environment variable is required')
  }
  if (!env.ETH_WS_URL) {
    throw new Error('ETH_WS_URL environment variable is required')
  }

  return {
    chainId: env.CHAIN_ID,
    network: env.NETWORK_NAME,
    rpcUrl: env.ETH_RPC_URL,
    wsUrl: env.ETH_WS_URL,
  }
}
