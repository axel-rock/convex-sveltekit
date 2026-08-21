/**
 * Server-side Convex client — for use in load functions, remote functions, and server hooks.
 * Uses ConvexHttpClient (stateless HTTP) instead of ConvexClient (WebSocket).
 *
 * Auth-aware: reads `event.locals.convexToken` from the current request context
 * via SvelteKit's `getRequestEvent()`. Authenticated requests use a per-request
 * client to avoid cross-request token leakage.
 */
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server"
import type { RequestEvent } from "@sveltejs/kit"
import { getConvexUrl } from "./client.svelte.js"
import { selectLiveConvexToken } from "$lib/auth/convex-session-token"
import { refreshJwtFromSession } from "$lib/auth/session.server.js"

let _httpClient: ConvexHttpClient | null = null

/** Unauthenticated singleton — reused for public queries. */
function getUnauthenticatedClient(): ConvexHttpClient {
  if (!_httpClient) {
    _httpClient = new ConvexHttpClient(getConvexUrl(), { skipConvexDeploymentUrlCheck: true })
  }
  return _httpClient
}

/** Get current request event when available (SSR/server request context only). */
async function getRequestEvent(): Promise<RequestEvent | null> {
  try {
    const { getRequestEvent } = await import("$app/server")
    return getRequestEvent() ?? null
  } catch {
    return null
  }
}

export async function resolveLiveConvexToken(explicit?: string | null): Promise<string | null> {
  const event = await getRequestEvent()
  return selectLiveConvexToken({
    explicit,
    localsToken: event?.locals.convexToken ?? null,
    remint: async () => {
      if (!event) return null
      const refreshed = await refreshJwtFromSession(event)
      if (!refreshed) {
        console.error("[convex/server] failed to refresh JWT from session")
        return null
      }
      event.locals.convexToken = refreshed
      return refreshed
    },
  })
}

async function getTokenFromRequest(): Promise<string | null> {
  return resolveLiveConvexToken()
}

async function getHttpClient(): Promise<ConvexHttpClient> {
  const token = await getTokenFromRequest()
  if (token) {
    const client = new ConvexHttpClient(getConvexUrl(), { skipConvexDeploymentUrlCheck: true })
    client.setAuth(token)
    return client
  }

  return getUnauthenticatedClient()
}

/** One-shot server-side query. Auth-aware via request context. */
export async function serverQuery<Query extends FunctionReference<"query">>(
  ref: Query,
  args: FunctionArgs<Query>,
): Promise<FunctionReturnType<Query>> {
  return (await getHttpClient()).query(ref, args)
}

/** One-shot server-side mutation. Auth-aware via request context. */
export async function serverMutation<Mutation extends FunctionReference<"mutation">>(
  ref: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<FunctionReturnType<Mutation>> {
  return (await getHttpClient()).mutation(ref, args)
}

/** One-shot server-side action. Auth-aware via request context. */
export async function serverAction<Action extends FunctionReference<"action">>(
  ref: Action,
  args: FunctionArgs<Action>,
): Promise<FunctionReturnType<Action>> {
  return (await getHttpClient()).action(ref, args)
}

/**
 * One-shot client authenticated with an EXPLICIT JWT instead of the ambient
 * request context. Chat tools thread the launching user's token here; session
 * JWTs are reminted when they near expiry so a long turn stays authenticated.
 */
function clientWithToken(token: string | null): ConvexHttpClient {
  const client = new ConvexHttpClient(getConvexUrl(), { skipConvexDeploymentUrlCheck: true })
  if (token) client.setAuth(token)
  return client
}

/** Like {@link serverQuery} but authenticated with an explicit JWT. */
export async function serverQueryAs<Query extends FunctionReference<"query">>(
  token: string | null,
  ref: Query,
  args: FunctionArgs<Query>,
): Promise<FunctionReturnType<Query>> {
  return clientWithToken(await resolveLiveConvexToken(token)).query(ref, args)
}

/** Like {@link serverMutation} but authenticated with an explicit JWT. */
export async function serverMutationAs<Mutation extends FunctionReference<"mutation">>(
  token: string | null,
  ref: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<FunctionReturnType<Mutation>> {
  return clientWithToken(await resolveLiveConvexToken(token)).mutation(ref, args)
}

/** Like {@link serverAction} but authenticated with an explicit JWT. */
export async function serverActionAs<Action extends FunctionReference<"action">>(
  token: string | null,
  ref: Action,
  args: FunctionArgs<Action>,
): Promise<FunctionReturnType<Action>> {
  return clientWithToken(await resolveLiveConvexToken(token)).action(ref, args)
}
