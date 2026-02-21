import type { HttpProxyEndpointConfig } from '@missionsquad/x402-proxy'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function buildSearchX402Endpoints(upstreamOrigin: string): HttpProxyEndpointConfig[] {
  const base = trimTrailingSlash(upstreamOrigin)

  return [
    {
      kind: 'http',
      id: 'search-global',
      method: 'GET',
      publicPath: '/v1/search',
      upstreamUrl: `${base}/v1/search`,
      price: '0.02',
    },
    {
      kind: 'http',
      id: 'search-agents',
      method: 'GET',
      publicPath: '/v1/search/agents',
      upstreamUrl: `${base}/v1/search/agents`,
      price: '0.02',
    },
    {
      kind: 'http',
      id: 'agents-directory-search',
      method: 'GET',
      publicPath: '/v1/agents',
      upstreamUrl: `${base}/v1/agents`,
      price: '0.02',
    },
  ]
}
