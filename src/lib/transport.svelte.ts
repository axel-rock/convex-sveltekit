/**
 * SSR bridge — convexLoad() + transport encode/decode.
 *
 * On the server, convexLoad fetches via ConvexHttpClient (auth-aware).
 * On the client, transport.decode (server loads) or the hydration script
 * (universal loads) seeds a live subscription with that result.
 * On client-side navigation, convexLoad creates a live subscription directly.
 */
import type { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server"
import { getFunctionName, makeFunctionReference } from "convex/server"
import { ConvexHttpClient, type ConvexClient } from "convex/browser"
import { browser } from "$app/environment"
import { getConvexClient, getConvexUrl, getServerConvexToken } from "./client.svelte.js"
import { forgetServerQuery, hydratedQueryResult, recordServerQuery } from "./hydration.js"
import {
  createDetachedQuery,
  WARM_SUBSCRIPTION_MS,
  type ConvexQueryResult,
} from "./query.svelte.js"

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
 *   The client seeds a live subscription with it: through the transport hook for
 *   server loads, through the page head's hydration script for universal loads.
 * - **Client (navigation):** reuses cached data when available, otherwise
 *   (`waitForData`) waits for the first value of a subscription it keeps open a
 *   few seconds for the page to join. The returned result subscribes while rendered.
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
  options: { waitForData?: boolean } = {},
): Promise<ConvexQueryResult<Query>> {
  if (browser) {
    const client = getConvexClient()
    const name = getFunctionName(ref)
    // Hydration reruns universal loads before layout auth mounts: the server's
    // own result keeps its HTML on screen instead of a loading state.
    let initialData = hydratedQueryResult(name, args)
    if (initialData === undefined && !client.disabled) {
      try {
        initialData = client.client.localQueryResult(name, args)
      } catch {
        // A cached auth error must be retried by the live subscription.
      }
    }
    // Never subscribe anonymously: the first login's layout must install
    // authentication first. The rendered subscription recovers either way.
    const firstValue =
      !client.disabled &&
      client.client.hasAuth() &&
      globalThis.document?.body?.hasAttribute("data-hydrated")
        ? keepWarm(client, ref, args)
        : undefined
    if (options.waitForData && initialData === undefined && firstValue) {
      initialData = await firstValue
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
  const result = new ConvexLoadResult(name, args as Record<string, unknown>, data)
  // A universal load's result is not serialized by SvelteKit; the page head carries it.
  recordServerQuery(result)
  return result as unknown as ConvexQueryResult<Query>
}

/**
 * Subscribe now and resolve with the first value. The subscription stays open
 * for a few seconds so the page that renders this load (or the click after a
 * hover preload) joins it instead of asking the server again.
 */
function keepWarm<Query extends FunctionReference<"query">>(
  client: ConvexClient,
  ref: Query,
  args: FunctionArgs<Query>,
): Promise<FunctionReturnType<Query>> {
  const first = new Promise<FunctionReturnType<Query>>((resolve, reject) => {
    const unsubscribe = client.onUpdate(ref, args, resolve, reject)
    setTimeout(unsubscribe, WARM_SUBSCRIPTION_MS)
  })
  // A preload nobody awaits must not surface as an unhandled rejection.
  first.catch(() => {})
  return first
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
    forgetServerQuery(v)
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
