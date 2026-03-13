/**
 * Better Auth ↔ Convex auth bridge.
 *
 * Wires Better Auth session tokens into the ConvexClient so all
 * Convex queries/mutations run as the authenticated user.
 *
 * Call `setupConvexAuth({ authClient })` in the root layout (after `setupConvex()`).
 * Pass `initialToken` from SSR to pre-authenticate the WebSocket before subscriptions fire.
 * Read auth state anywhere via `useConvexAuth()`.
 */
import { createContext } from "svelte"
import { browser } from "$app/environment"
import { getConvexClient } from "./client.svelte.js"

// ============================================================================
// Types
// ============================================================================

/** Minimal type for the Better Auth client (avoids importing the full type). */
type AuthClient = {
  useSession: () => {
    subscribe: (
      cb: (state: { data: unknown; isPending: boolean }) => void,
    ) => (() => void) | { unsubscribe: () => void }
  }
  convex: { token: () => Promise<{ data: { token: string } | null }> }
}

type ConvexAuthState = {
  readonly isAuthenticated: boolean
  readonly isLoading: boolean
}

// ============================================================================
// Context
// ============================================================================

const [getAuthCtx, setAuthCtx] = createContext<ConvexAuthState>()

// ============================================================================
// Setup
// ============================================================================

/**
 * Wire Better Auth into the Convex client.
 * Must be called during component init (root layout), after `setupConvex()`.
 *
 * When `initialToken` is provided (from SSR), the ConvexClient authenticates
 * immediately — before the WebSocket connects and before any $effect runs.
 * This eliminates the `authClient.convex.token()` HTTP call on first load
 * and prevents unauthenticated subscriptions from overwriting SSR data.
 */
export function setupConvexAuth({
  authClient,
  initialToken,
}: {
  authClient: AuthClient
  initialToken?: string | null
}) {
  const client = getConvexClient()

  let sessionData: unknown = $state(null)
  let sessionPending = $state(true)
  let convexAuthed: boolean | null = $state(null)

  if (browser)
    // Subscribe to Better Auth session state
    authClient
      .useSession()
      .subscribe((session: { data: unknown; isPending: boolean }) => {
        sessionData = session.data
        sessionPending = session.isPending
      })

  const hasSession = $derived(sessionData !== null)

  const isAuthenticated = $derived(
    (!!initialToken && convexAuthed === null) ||
    (hasSession && (convexAuthed ?? false)),
  )
  const isLoading = $derived(
    sessionPending || (hasSession && convexAuthed === null),
  )

  // Fetch a Convex-compatible JWT from Better Auth.
  // Returns pre-seeded token for cached requests (no network call on first load).
  const fetchAccessToken = async ({
    forceRefreshToken,
  }: {
    forceRefreshToken: boolean
  }) => {
    if (!forceRefreshToken) return initialToken ?? null
    try {
      const { data } = await authClient.convex.token()
      return data?.token ?? null
    } catch {
      return null
    }
  }

  // Pre-authenticate immediately — runs synchronously during component init,
  // before any $effect, before the WebSocket finishes connecting.
  if (initialToken) {
    client.setAuth(fetchAccessToken, (isAuthed: boolean) => {
      convexAuthed = isAuthed
    })
  }

  // Sync auth state: set/clear Convex auth when session changes.
  // When initialToken was provided, don't clear auth while session is still loading.
  $effect(() => {
    let active = true

    if (hasSession) {
      client.setAuth(fetchAccessToken, (isAuthed: boolean) => {
        if (active) convexAuthed = isAuthed
      })
    } else if (!sessionPending) {
      client.client.clearAuth()
      convexAuthed = null
    }

    return () => {
      active = false
    }
  })

  setAuthCtx({
    get isAuthenticated() {
      return isAuthenticated
    },
    get isLoading() {
      return isLoading
    },
  })
}

// ============================================================================
// Hook
// ============================================================================

/** Read auth state. Must be called under a component tree with `setupConvexAuth`. */
export function useConvexAuth(): ConvexAuthState {
  return getAuthCtx()
}
