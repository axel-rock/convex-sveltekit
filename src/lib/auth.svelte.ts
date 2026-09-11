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
import { createContext, onDestroy } from "svelte"
import { getConvexClient } from "./client.svelte.js"
import { browser } from "$app/environment"
import type { AuthClient } from "$lib/auth/client"
import type { ConvexClient } from "convex/browser"
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
 * Authenticate the shared Convex client from verified layout data, including
 * tokens returned after client-side sign-in. Better Auth's session subscription
 * supplies analytics identity; it does not delay the WebSocket handshake.
 */
export function setupConvexAuth({
  authClient,
  initialToken,
  hasServerUser,
  activeOrganizationId,
}: {
  authClient: AuthClient
  initialToken: () => string | null
  hasServerUser: () => boolean
  /** Server-verified active org id (layout data) — PostHog group analytics. */
  activeOrganizationId?: () => string | null
}) {
  const client = getConvexClient()

  let convexAuthed: boolean | null = $state(null)
  let missingSessionToken = $state<string | null | undefined>(undefined)
  let lastIdentifiedUserId: string | null = null

  // Subscribe to Better Auth session state
  const unsubscribe = authClient.useSession().subscribe((session) => {
    if (!browser) return

    if (session.data?.user) {
      missingSessionToken = undefined
      const { id, email, name } = session.data.user
      lastIdentifiedUserId = id
      Sentry.setUser({ id, email, username: name })

      identifyPosthog(id, { email, username: name })

      // Group after identify so this session's events roll up to the org.
      // Org switches force a full reload (JWT re-mint), which re-runs this.
      const organizationId = activeOrganizationId?.() ?? null
      if (organizationId) setOrganizationGroup(organizationId)
      // Same org id on Sentry so errors group by workspace (#578). Cleared
      // with the user below on sign-out.
      Sentry.setTag("organization_id", organizationId ?? undefined)

      const impersonatedBy = session.data.session?.impersonatedBy ?? null
      if (impersonatedBy) registerImpersonation(impersonatedBy)
      else clearImpersonation()
    } else {
      // A confirmed missing session still revokes browser access. A later
      // sign-in's new layout token can authenticate without waiting for BA.
      if (!session.isPending) missingSessionToken = initialToken()
      Sentry.setUser(null)
      Sentry.setTag("organization_id", undefined)
      if (!session.isPending && lastIdentifiedUserId) {
        resetPosthog()
        lastIdentifiedUserId = null
      }
    }
  })

  onDestroy(unsubscribe)

  const serverSignedIn = $derived(hasServerUser())
  const serverToken = $derived(
    serverSignedIn && initialToken() !== missingSessionToken ? initialToken() : null,
  )
  const isAuthenticated = $derived(!!serverToken && convexAuthed !== false)
  const isLoading = $derived(!!serverToken && convexAuthed === null)

  const syncAuthentication = createAuthBridge(client, authClient, (authenticated) => {
    convexAuthed = authenticated
  })
  const syncServerAuthentication = () => syncAuthentication(serverToken)
  if (browser) syncServerAuthentication()
  // Layout invalidation is the source of verified identity changes, including
  // sign-out. The external client needs an imperative update only on that change.
  $effect(syncServerAuthentication)

  setAuthCtx({
    get isAuthenticated() {
      return isAuthenticated
    },
    get isLoading() {
      return isLoading
    },
  })
}

/** Reuse verified tokens and ignore completions from an identity that has changed. */
export function createAuthBridge(
  client: Pick<ConvexClient, "setAuth" | "client">,
  authClient: Pick<AuthClient, "convex">,
  onChange: (authenticated: boolean | null) => void,
) {
  let configuredToken: string | null | undefined
  let generation = 0
  return (token: string | null) => {
    if (token === configuredToken) return
    configuredToken = token
    const currentGeneration = ++generation
    onChange(null)
    if (!token) {
      client.client.clearAuth()
      return
    }

    // SvelteKit returns this token after email sign-in too. Convex can use it
    // immediately and owns the subsequent refresh when it expires.
    client.setAuth(
      async ({ forceRefreshToken }) => {
        if (currentGeneration !== generation) return null
        if (!forceRefreshToken) return token
        try {
          const { data } = await authClient.convex.token()
          return currentGeneration === generation ? (data?.token ?? null) : null
        } catch {
          return null
        }
      },
      (authenticated) => {
        if (currentGeneration === generation) onChange(authenticated)
      },
    )
  }
}

// ============================================================================
// Hook
// ============================================================================

/** Read auth state. Must be called under a component tree with `setupConvexAuth`. */
export function useConvexAuth(): ConvexAuthState {
  return getAuthCtx()
}
