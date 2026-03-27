// Client lifecycle
export {
  initConvex,
  setupConvex,
  getConvexClient,
  getConvexUrl,
  useConvexClient,
} from "./client.svelte.js"

// Live queries
export { convexQuery, createDetachedQuery, type ConvexQueryResult } from "./query.svelte.js"

// Client-side forms (SvelteKit RemoteForm-compatible)
export { convexForm, type ConvexForm } from "./form.svelte.js"

// Programmatic mutations/actions (SvelteKit RemoteCommand-compatible)
export { convexCommand, type ConvexCommand } from "./command.svelte.js"

// SSR bridge
export {
  convexLoad,
  ConvexLoadResult,
  encodeConvexLoad,
  decodeConvexLoad,
} from "./transport.svelte.js"

// Auth bridge (Better Auth ↔ Convex)
export { setupConvexAuth, useConvexAuth } from "./auth.svelte.js"

// User transport (JWT seed → live Convex subscription)
export {
  convexUser,
  ConvexUserResult,
  encodeConvexUser,
  decodeConvexUser,
  type ConvexUserData,
} from "./user.svelte.js"
