# Changelog

## 0.1.12

- **fix:** move demo-only files (`auth.server.ts`, `auth-client.ts`) out of published package
- **ci:** add CI workflow (svelte-check, unit tests, package validation)
- **ci:** add package integration test — verifies all exports are consumable

## 0.1.11

- **fix:** change how `initConvex` is called to avoid initial 500

## 0.1.10

- **feat:** Better Auth integration with working demo
- **feat:** `setupConvexAuth` / `useConvexAuth` auth bridge
- **feat:** `convexUser` / `decodeConvexUser` SSR-to-live user transport
- **docs:** BETTER_AUTH.md setup guide

## 0.1.9

- **feat:** `initialToken` support in `initConvex` for pre-authenticated WebSocket
- **feat:** `serverQuery` / `serverMutation` / `serverAction` server-side helpers

## 0.1.0

- Initial release
- `convexQuery` — live reactive queries
- `convexLoad` / `encodeConvexLoad` / `decodeConvexLoad` — SSR transport
- `convexForm` — form spreading with Convex mutations
- `convexCommand` — programmatic mutations/actions
