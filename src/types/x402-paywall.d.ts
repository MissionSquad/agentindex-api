/**
 * Minimal ambient types for @x402/paywall (pinned to 2.4.0).
 *
 * The package publishes its type declarations only through the package.json
 * `exports` map, which this project's `moduleResolution: "node"` cannot read.
 * Node itself resolves the runtime require() through `exports` without issue,
 * so only the compiler needs this shim. Keep in sync with the pinned version's
 * public API (createPaywall builder + network handlers).
 */
declare module '@x402/paywall' {
  /** Network-specific paywall handler (opaque — pass to withNetwork). */
  export interface PaywallNetworkHandler {
    [key: string]: unknown
  }

  export interface PaywallConfig {
    appName?: string
    appLogo?: string
    currentUrl?: string
    testnet?: boolean
  }

  /** Matches @x402/core's PaywallProvider structurally. */
  export interface PaywallProvider {
    generateHtml(paymentRequired: unknown, config?: unknown): string
  }

  export class PaywallBuilder {
    withNetwork(handler: PaywallNetworkHandler): this
    withConfig(config: PaywallConfig): this
    build(): PaywallProvider
  }

  export function createPaywall(): PaywallBuilder

  export const evmPaywall: PaywallNetworkHandler
  export const svmPaywall: PaywallNetworkHandler
}
