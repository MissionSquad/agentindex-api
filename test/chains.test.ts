import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock env before importing the module under test
vi.mock('../src/env', () => ({
  env: {
    CHAIN_ID: 1,
    NETWORK_NAME: 'mainnet',
    ETH_RPC_URL: 'https://eth-rpc.example.com',
    ETH_WS_URL: 'wss://eth-ws.example.com',
  },
}))

describe('getChainConfig', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns chain config when env vars are set', async () => {
    const { getChainConfig } = await import('../src/config/chains')
    const config = getChainConfig()

    expect(config.chainId).toBe(1)
    expect(config.network).toBe('mainnet')
    expect(config.rpcUrl).toBe('https://eth-rpc.example.com')
    expect(config.wsUrl).toBe('wss://eth-ws.example.com')
  })

  it('throws when ETH_RPC_URL is missing', async () => {
    vi.doMock('../src/env', () => ({
      env: {
        CHAIN_ID: 1,
        NETWORK_NAME: 'mainnet',
        ETH_RPC_URL: '',
        ETH_WS_URL: 'wss://eth-ws.example.com',
      },
    }))

    const { getChainConfig } = await import('../src/config/chains')
    expect(() => getChainConfig()).toThrow('ETH_RPC_URL environment variable is required')
  })

  it('throws when ETH_WS_URL is missing', async () => {
    vi.doMock('../src/env', () => ({
      env: {
        CHAIN_ID: 1,
        NETWORK_NAME: 'mainnet',
        ETH_RPC_URL: 'https://eth-rpc.example.com',
        ETH_WS_URL: '',
      },
    }))

    const { getChainConfig } = await import('../src/config/chains')
    expect(() => getChainConfig()).toThrow('ETH_WS_URL environment variable is required')
  })
})
