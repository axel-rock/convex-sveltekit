/**
 * SSR bridge — convexLoad() + transport encode/decode.
 *
 * On the server, convexLoad fetches via ConvexHttpClient (auth-aware).
 * On the client, transport.decode upgrades it to a live subscription.
 * On client-side navigation, convexLoad creates a live subscription directly.
 */
import type { FunctionReference, FunctionArgs } from "convex/server"
import { getFunctionName, makeFunctionReference } from "convex/server"
import { ConvexHttpClient } from "convex/browser"
import { getConvexUrl } from "./client.svelte.js"
import { createDetachedQuery, type ConvexQueryResult } from "./query.svelte.js"

const IS_BROWSER = typeof globalThis.document !== "undefined"

// ============================================================================
// ConvexLoadResult — the serializable container
// ============================================================================

/** Marker class for transport.encode to recognize */
export class ConvexLoadResult<T = unknown> {
  readonly __convexLoad = true

  constructor(
    public readonly refName: string,
    public readonly args: Record<string, unknown>,
    public readonly data: T,
  ) {}
}

// ============================================================================
// Server-side auth helper
// ============================================================================

/**
 * Get auth token from the current SvelteKit request context.
 * Uses dynamic import() — $app/server is a Vite virtual module, require() won't resolve it.
 */
async function getTokenFromRequest(): Promise<string | null> {
  if (IS_BROWSER) return null
  try {
    const { getRequestEvent } = await import("$app/server")
    const event = getRequestEvent()
    return event?.locals?.convexToken ?? null
  } catch {
    return null
  }
}

// ============================================================================
// convexLoad — for load functions
// ============================================================================

/**
 * Fetch Convex data for use in load functions. Smart about where it runs:
 *
 * - **Server (SSR):** fetches via ConvexHttpClient (auth-aware), returns ConvexLoadResult.
 *   Transport hook decodes it into a live subscription on the client.
 * - **Client (navigation):** creates a live subscription directly via
 *   createDetachedQuery(). Returns a reactive ConvexQueryResult immediately.
 *
 * ```ts
 * // +page.ts
 * export const load = async () => ({
 *   tasks: await convexLoad(api.tasks.get, {})
 * })
 * ```
 */
export async function convexLoad<Query extends FunctionReference<"query">>(
  ref: Query,
  args: FunctionArgs<Query>,
): Promise<ConvexQueryResult<Query>> {
  const httpClient = new ConvexHttpClient(getConvexUrl(), { skipConvexDeploymentUrlCheck: true })

  if (!IS_BROWSER) {
    // Server-side: set auth token if available
    const token = await getTokenFromRequest()
    if (token) httpClient.setAuth(token)
  }

  if (IS_BROWSER) {
    // Client-side navigation: fetch initial data, then create live subscription
    const initialData = await httpClient.query(ref, args)
    return createDetachedQuery(ref, args, initialData) as ConvexQueryResult<Query>
  }

  // Server-side: HTTP fetch, wrap in ConvexLoadResult for transport.
  // transport.decode replaces this with a ConvexQueryResult on the client.
  const data = await httpClient.query(ref, args)
  const name = getFunctionName(ref)
  return new ConvexLoadResult(
    name,
    args as Record<string, unknown>,
    data,
  ) as unknown as ConvexQueryResult<Query>
}

// ============================================================================
// Transport encode/decode — for hooks.ts
// ============================================================================

/** Encode a ConvexLoadResult for serialization across the SSR boundary.
 *  Uses duck-type check (`__convexLoad`) instead of `instanceof` because
 *  Vite HMR can create separate class identities for the same module. */
export function encodeConvexLoad(
  value: unknown,
): false | { refName: string; args: Record<string, unknown>; data: unknown } {
  if (
    value instanceof ConvexLoadResult ||
    (value != null && typeof value === "object" && "__convexLoad" in value)
  ) {
    const v = value as ConvexLoadResult
    return { refName: v.refName, args: v.args, data: v.data }
  }
  return false
}

/** Decode a serialized ConvexLoadResult into a live query subscription.
 *  Uses createDetachedQuery — works outside component context (transport.decode). */
export function decodeConvexLoad(encoded: {
  refName: string
  args: Record<string, unknown>
  data: unknown
}): ConvexQueryResult<FunctionReference<"query">> {
  const ref = makeFunctionReference<"query">(encoded.refName)
  return createDetachedQuery(ref, encoded.args, encoded.data)
}
