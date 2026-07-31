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
import { getConvexClient } from "./client.svelte.js"
import { browser } from "$app/environment"
import type { AuthClient } from "$lib/auth/client"
import * as Sentry from "@sentry/sveltekit"
import {
  identify as identifyPosthog,
  resetPosthog,
  registerImpersonation,
  clearImpersonation,
  setOrganizationGroup,
} from "$lib/analytics/posthog.js"

// ============================================================================
// Types
// ============================================================================

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
 *
 * `hasServerUser` is a reactive getter that returns `true` iff the layout's
 * server-side load returned a user (cookies present and verified). It's the
 * authoritative "did the server say I'm signed in?" signal — we use it to
 * tear down the WebSocket when the sign-out form clears cookies without
 * waiting on BA's `useSession()` cache to notice. BA's nanostore only
 * auto-refreshes on window focus and a fixed interval, so without this
 * server-driven signal the WebSocket would stay authenticated across an
 * SPA sign-out and the live `getCurrentUser` query would keep streaming
 * the just-signed-out user.
 */
export function setupConvexAuth({
  authClient,
  initialToken,
  hasServerUser,
  activeOrganizationId,
}: {
  authClient: AuthClient
  initialToken?: string | null
  hasServerUser: () => boolean
  /** Server-verified active org id (layout data) — PostHog group analytics. */
  activeOrganizationId?: () => string | null
}) {
  const client = getConvexClient()

  let sessionData: unknown = $state(null)
  let sessionPending = $state(true)
  let convexAuthed: boolean | null = $state(null)
  let lastIdentifiedUserId: string | null = null

  // Subscribe to Better Auth session state
  authClient.useSession().subscribe((session) => {
    sessionData = session.data
    sessionPending = session.isPending

    if (!browser) return

    if (session.data?.user) {
      const { id, email, name } = session.data.user
      lastIdentifiedUserId = id
      Sentry.setUser({ id, email, username: name })

      identifyPosthog(id, { email, username: name })

      // Group after identify so this session's events roll up to the org.
      // Org switches force a full reload (JWT re-mint), which re-runs this.
      const organizationId = activeOrganizationId?.() ?? null
      if (organizationId) setOrganizationGroup(organizationId)

      const impersonatedBy = session.data.session?.impersonatedBy ?? null
      if (impersonatedBy) registerImpersonation(impersonatedBy)
      else clearImpersonation()
    } else {
      Sentry.setUser(null)
      if (!session.isPending && lastIdentifiedUserId) {
        resetPosthog()
        lastIdentifiedUserId = null
      }
    }
  })

  const serverSignedIn = $derived(hasServerUser())
  const hasSession = $derived(sessionData !== null)

  const isAuthenticated = $derived(
    (!!initialToken && convexAuthed === null) ||
      (serverSignedIn && hasSession && (convexAuthed ?? false)),
  )
  const isLoading = $derived(
    serverSignedIn && (sessionPending || (hasSession && convexAuthed === null)),
  )

  // Fetch a Convex-compatible JWT from Better Auth.
  // Returns pre-seeded token for cached requests (no network call on first load).
  // The better-auth client aborts superseded token requests when session
  // refreshes overlap (the post-login invalidation storm fires several), and
  // an abort used to read as a silent null: the WebSocket stayed
  // unauthenticated and isAuthenticated never flipped. Retry through the
  // storm; ponytail: 5 tries at 300ms bounds it.
  const fetchAccessToken = async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (!forceRefreshToken) return initialToken ?? null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { data } = await authClient.convex.token()
        if (data?.token) return data.token
      } catch {
        // Aborted by a concurrent session refresh; the next try usually lands.
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return null
  }

  // Pre-authenticate immediately — runs synchronously during component init,
  // before any $effect, before the WebSocket finishes connecting.
  if (initialToken) {
    client.setAuth(fetchAccessToken, (isAuthed: boolean) => {
      convexAuthed = isAuthed
    })
  }

  // Sync auth state. The server is the source of truth for "am I signed in?".
  //
  //   - serverSignedIn === false → cookies are gone (sign-out, org-switch
  //     mid-mint, etc.). Clear auth even if BA's stale nanostore still
  //     reports a session. This is what makes `<form {...signOut}>` work
  //     without a custom JS handler: when invalidateAll runs and the layout
  //     loader returns `user: null`, the next render flips this flag and
  //     the WebSocket detaches in the same tick.
  //   - serverSignedIn === true and BA reports a session → set auth.
  //   - serverSignedIn === true but BA still pending → wait, don't touch
  //     the pre-authenticated WebSocket (avoids a flicker on first load).
  $effect(() => {
    let active = true

    if (!serverSignedIn) {
      client.client.clearAuth()
      convexAuthed = null
    } else if (hasSession) {
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
