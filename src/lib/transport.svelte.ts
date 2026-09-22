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
import { browser } from "$app/environment"
import { getConvexClient, getConvexUrl, getServerConvexToken } from "./client.svelte.js"
import { createDetachedQuery, type ConvexQueryResult } from "./query.svelte.js"

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
// convexLoad — for load functions
// ============================================================================

/**
 * Fetch Convex data for use in load functions. Smart about where it runs:
 *
 * - **Server (SSR):** fetches via ConvexHttpClient (auth-aware), returns ConvexLoadResult.
 *   Transport hook decodes it into a live subscription on the client.
 * - **Client (navigation):** reads through the authenticated client, reusing cached
 *   data when available. The returned result subscribes while rendered.
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
  if (browser) {
    // A universal load can run before layout auth mounts. Reuse a cached value
    // without awaiting an anonymous request; the rendered subscription recovers
    // when auth arrives and is released when the page leaves.
    const client = getConvexClient()
    let initialData
    try {
      initialData = client.disabled
        ? undefined
        : client.client.localQueryResult(getFunctionName(ref), args)
    } catch {
      // A cached auth error must be retried by the live subscription.
    }
    return createDetachedQuery(ref, args, initialData) as ConvexQueryResult<Query>
  }

  const httpClient = new ConvexHttpClient(getConvexUrl(), { skipConvexDeploymentUrlCheck: true })

  const token = getServerConvexToken()
  if (token) httpClient.setAuth(token)

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
