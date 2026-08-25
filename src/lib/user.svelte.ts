/**
 * Convex User Transport — SSR-to-live upgrade for authenticated user data.
 *
 * Seeds the user from JWT claims (available instantly on the server), then
 * upgrades to a live Convex subscription on the client. Preloads profile
 * images before swapping state to prevent visual flicker.
 *
 * Usage:
 * ```ts
 * // +layout.server.ts
 * import { convexUser } from "$lib/convex"
 * export const load = async ({ locals }) => ({
 *   user: convexUser(locals.user),
 * })
 *
 * // +layout.svelte — data.user is reactive, auto-upgrades to Convex data
 * <AppSidebar user={data.user} />
 * ```
 */
import type { FunctionReference, FunctionArgs } from "convex/server"
import { getConvexClient } from "./client.svelte.js"

// ============================================================================
// Types
// ============================================================================

/** Shape of the user object (JWT seed + Convex live data). */
export type ConvexUserData = {
  id: string
  email: string
  emailVerified?: boolean
  name: string
  image?: string | null
  isAnonymous?: boolean
  isAdmin?: boolean
  impersonatedBy?: string | null
  [key: string]: unknown
}

// ============================================================================
// ConvexUserResult — server-side marker
// ============================================================================

/**
 * Marker class for the transport hook. On the server, properties from `data`
 * are copied onto the instance via Object.assign so that SSR template access
 * (e.g. `user.image`) works without decoding.
 */
export class ConvexUserResult<T extends Record<string, unknown> = ConvexUserData> {
  readonly __convexUser = true

  constructor(data: T) {
    Object.assign(this, data)
  }
}

// ============================================================================
// convexUser — convenience wrapper for load functions
// ============================================================================

/**
 * Wrap user data for transport. Returns null when there's no user.
 *
 * ```ts
 * // +layout.server.ts
 * user: convexUser(locals.user)
 * ```
 */
export function convexUser<T extends Record<string, unknown>>(
  data: T | null | undefined,
): T | null {
  if (!data) return null
  return new ConvexUserResult(data) as unknown as T
}

// ============================================================================
// Transport encode/decode
// ============================================================================

/**
 * Encode a ConvexUserResult for serialization across the SSR boundary.
 * Duck-type check (`__convexUser`) because Vite HMR can create separate class identities.
 */
export function encodeConvexUser(value: unknown): false | { data: Record<string, unknown> } {
  if (
    value instanceof ConvexUserResult ||
    (value != null && typeof value === "object" && "__convexUser" in value)
  ) {
    // Strip the marker — serialize only the user fields
    const data: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(
      value as ConvexUserResult & Record<string, unknown>,
    )) {
      if (key !== "__convexUser") data[key] = entry
    }
    return { data }
  }
  return false
}

/**
 * Decode a serialized ConvexUserResult into a reactive proxy that:
 * 1. Starts with the JWT-seeded data (includes image from definePayload)
 * 2. Subscribes to a Convex query for live updates
 * 3. Ignores null results (unauthenticated cold start before setupConvexAuth)
 * 4. Preloads images before swapping state to prevent flicker
 *
 * The query ref and args are passed from hooks.ts — keeps this module generic.
 */
export function decodeConvexUser<Query extends FunctionReference<"query">>(
  encoded: { data: Record<string, unknown> },
  queryRef: Query,
  args: FunctionArgs<Query>,
): ConvexUserData {
  const seed = encoded.data as ConvexUserData

  let current: ConvexUserData = $state(seed)

  const client = getConvexClient()

  if (!client.disabled) {
    client.onUpdate(
      queryRef,
      args,
      (result: ConvexUserData | null) => {
        if (result === null) return // ignore unauthenticated subscription result

        // Preload new image before updating state to prevent flicker
        if (result.image && result.image !== current.image) {
          const img = new Image()
          img.onload = () => {
            current = result
          }
          img.onerror = () => {
            current = result
          }
          img.src = result.image
        } else {
          current = result
        }
      },
      () => {
        // Query error — keep showing JWT data, don't crash
      },
    )
  }

  // Expose the live user as a raw-ish object so new JWT fields flow through
  // without whitelisting every property here.
  return new Proxy({} as ConvexUserData, {
    get(_target: ConvexUserData, prop: PropertyKey) {
      return (current as Record<PropertyKey, unknown>)[prop]
    },
    has(_target: ConvexUserData, prop: PropertyKey) {
      return prop in (current as Record<PropertyKey, unknown>)
    },
    ownKeys() {
      return Reflect.ownKeys(current as Record<PropertyKey, unknown>)
    },
    getOwnPropertyDescriptor(_target: ConvexUserData, prop: PropertyKey) {
      const record = current as Record<PropertyKey, unknown>
      if (!(prop in record)) return undefined
      return {
        configurable: true,
        enumerable: true,
        value: record[prop],
        writable: false,
      }
    },
  })
}
