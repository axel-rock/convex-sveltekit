/**
 * ConvexClient lifecycle — module singleton + typesafe Svelte context.
 *
 * Two init points (both idempotent, share the same instance):
 * - `initConvex(url)` in hooks.client.ts — early init so transport.decode can subscribe
 * - `setupConvex(url)` in root layout — handles SSR (disabled client) + context + cleanup
 */
import { ConvexClient, type ConvexClientOptions } from "convex/browser"
import { createContext } from "svelte"

// ============================================================================
// Typesafe context
// ============================================================================

const [getConvexContext, setConvexContext] = createContext<ConvexClient>()

// ============================================================================
// Module-level singleton
// ============================================================================

let _client: ConvexClient | null = null
let _url: string | null = null

const IS_BROWSER = typeof globalThis.document !== "undefined"

/**
 * Initialize the Convex client at module level (before any component mounts).
 * Call from `hooks.client.ts` to ensure the client exists before transport.decode.
 * Idempotent — subsequent calls are no-ops.
 */
export function initConvex(url: string, options: ConvexClientOptions = {}): ConvexClient {
  if (_client) return _client
  if (!url || typeof url !== "string") {
    throw new Error("[convex-sveltekit] initConvex requires a non-empty URL string")
  }
  _url = url
  // Self-hosted deployments use plain http(s) URLs that fail the SDK's
  // *.convex.cloud shape check, skip it (the URL comes from our own env).
  _client = new ConvexClient(url, {
    disabled: !IS_BROWSER,
    skipConvexDeploymentUrlCheck: true,
    ...options,
  })
  return _client
}

/**
 * Set up Convex in a component tree (root layout).
 * Reuses the module-level client if already created (hooks.client.ts ran first),
 * otherwise creates one (SSR path). Sets typesafe context + registers cleanup.
 */
export function setupConvex(url: string, options: ConvexClientOptions = {}): ConvexClient {
  const client = initConvex(url, options)
  setConvexContext(client)
  $effect(() => () => client.close())
  return client
}

// ============================================================================
// Access helpers
// ============================================================================

/** Module-level access — works anywhere (hooks, transport, utilities). */
export function getConvexClient(): ConvexClient {
  if (!_client) {
    throw new Error(
      "[convex-sveltekit] Client not initialized. Call initConvex() first (e.g. in hooks.client.ts)",
    )
  }
  return _client
}

/** Get the stored Convex URL (for server-side HTTP client). */
export function getConvexUrl(): string {
  if (!_url) {
    throw new Error("[convex-sveltekit] URL not set. Call initConvex() first.")
  }
  return _url
}

/** Context access — works in components under setupConvex(). Typesafe. */
export function useConvexClient(): ConvexClient {
  return getConvexContext()
}
