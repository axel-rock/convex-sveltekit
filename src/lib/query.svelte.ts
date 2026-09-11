/**
 * convexQuery() — live Convex query with SvelteKit-compatible API.
 *
 * Returns a reactive object matching the shape of SvelteKit's RemoteQuery:
 * - Getters: .data, .isLoading, .error, .isStale, .current, .loading, .ready
 * - Methods: .set(), .refresh(), .withOverride()
 *
 * Uses the module-level ConvexClient singleton (not Svelte context),
 * so it works inside transport.decode and other non-component code.
 *
 * Adapted from convex-svelte's useQuery — all reactive subscription logic preserved.
 */
import type { FunctionReference, FunctionReturnType, FunctionArgs } from "convex/server"
import { getFunctionName } from "convex/server"
import { convexToJson } from "convex/values"
import { getConvexClient } from "./client.svelte.js"
import { createSubscriber } from "svelte/reactivity"

// ============================================================================
// Types
// ============================================================================

type Skip = typeof SKIP

type ArgsOrSkip<Query extends FunctionReference<"query">> =
  FunctionArgs<Query> | "skip" | (() => FunctionArgs<Query> | "skip")

interface ConvexQueryOptions<Query extends FunctionReference<"query">> {
  initialData?: FunctionReturnType<Query>
  keepPreviousData?: boolean
}

/** Reactive query result — superset of convex-svelte's shape + SvelteKit RemoteQuery compat */
export interface ConvexQueryResult<Query extends FunctionReference<"query">> {
  /** Query result data (undefined while loading or on error) */
  readonly data: FunctionReturnType<Query> | undefined
  /** True while waiting for first result (false when skipped) */
  readonly isLoading: boolean
  /** Error if query failed */
  readonly error: Error | undefined
  /** True if showing stale data from previous args */
  readonly isStale: boolean

  // --- SvelteKit RemoteQuery compat ---

  /** Alias for `data` — current value of the query */
  readonly current: FunctionReturnType<Query> | undefined
  /** Alias for `isLoading` */
  readonly loading: boolean
  /** True once first data has arrived */
  readonly ready: boolean

  // --- Methods ---

  /** Imperatively set the query value (optimistic update) */
  set(value: FunctionReturnType<Query>): void
  /** Re-subscribe to force a fresh result */
  refresh(): Promise<void>
  /** Create an override descriptor for use with form.enhance().submit().updates() */
  withOverride(update: (current: FunctionReturnType<Query>) => FunctionReturnType<Query>): {
    _key: string
    release: () => void
  }
}

// ============================================================================
// Internal sentinel
// ============================================================================

const SKIP = Symbol("convex.query.skip")

// ============================================================================
// Main
// ============================================================================

/**
 * Subscribe to a Convex query. Returns a reactive object with live-updating data.
 *
 * ```ts
 * const tasks = convexQuery(api.tasks.get, {})
 * // tasks.data, tasks.isLoading, tasks.error
 * ```
 *
 * Supports conditional queries:
 * ```ts
 * const user = convexQuery(api.users.get, () => userId ? { id: userId } : "skip")
 * ```
 */
export function convexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: ArgsOrSkip<Query> = {} as FunctionArgs<Query>,
  options: ConvexQueryOptions<Query> | (() => ConvexQueryOptions<Query>) = {},
): ConvexQueryResult<Query> {
  const client = getConvexClient()

  if (typeof query === "string") {
    throw new Error("[convex] query must be a FunctionReference, not a string")
  }

  // --- reactive state ---
  const state: {
    result: FunctionReturnType<Query> | Error | undefined
    lastResult: FunctionReturnType<Query> | Error | undefined
    argsForLastResult: FunctionArgs<Query> | Skip | undefined
    haveArgsEverChanged: boolean
    manualOverride: FunctionReturnType<Query> | undefined
    hasManualOverride: boolean
    refreshCounter: number
  } = $state({
    result: parseOptions(options).initialData,
    lastResult: undefined,
    argsForLastResult: undefined,
    haveArgsEverChanged: false,
    manualOverride: undefined,
    hasManualOverride: false,
    refreshCounter: 0,
  })

  // --- subscription effect ---
  $effect(() => {
    // Touch refreshCounter to allow refresh() to force re-subscribe
    void state.refreshCounter
    const argsObject = parseArgs(args)

    if (argsObject === SKIP) {
      state.result = undefined
      state.argsForLastResult = SKIP
      return
    }

    const unsubscribe = client.onUpdate(
      query,
      argsObject,
      (dataFromServer: FunctionReturnType<Query>) => {
        const copy = structuredClone(dataFromServer)
        state.result = copy
        state.argsForLastResult = argsObject
        state.lastResult = copy
        // Clear manual override when server data arrives
        state.hasManualOverride = false
      },
      (e: Error) => {
        state.result = e
        state.argsForLastResult = argsObject
        state.lastResult = structuredClone(e)
        state.hasManualOverride = false
      },
    )

    return unsubscribe
  })

  // --- derived computations ---
  const currentArgs = $derived(parseArgs(args))
  const initialArgs = parseArgs(args)
  const isSkipped = $derived(currentArgs === SKIP)

  const sameArgsAsLastResult = $derived(
    state.argsForLastResult !== undefined &&
      currentArgs !== SKIP &&
      state.argsForLastResult !== SKIP &&
      jsonEqualArgs(
        state.argsForLastResult as FunctionArgs<Query>,
        currentArgs as FunctionArgs<Query>,
      ),
  )

  const staleAllowed = $derived(!!(parseOptions(options).keepPreviousData && state.lastResult))

  // Track args changes to stop using initialData
  $effect(() => {
    if (!$state.snapshot(state).haveArgsEverChanged) {
      const curr = parseArgs(args)
      if (!argsKeyEqual(initialArgs, curr)) {
        state.haveArgsEverChanged = true
        const opts = parseOptions(options)
        if (opts.initialData !== undefined) {
          state.argsForLastResult =
            initialArgs === SKIP ? SKIP : ($state.snapshot(initialArgs) as FunctionArgs<Query>)
          state.lastResult = opts.initialData
        }
      }
    }
  })

  // Sync result from local cache
  const syncResult = $derived.by(() => {
    if (isSkipped) return undefined

    const opts = parseOptions(options)
    if (opts.initialData && !state.haveArgsEverChanged) {
      return state.result
    }

    let value: FunctionReturnType<Query> | Error | undefined
    try {
      value = client.disabled
        ? undefined
        : (client.client.localQueryResult(
            getFunctionName(query),
            currentArgs as FunctionArgs<Query>,
          ) as FunctionReturnType<Query> | undefined)
    } catch (e) {
      if (!(e instanceof Error)) throw e
      value = e
    }

    // Touch reactive state.result so updates retrigger
    void state.result
    return value
  })

  const resolvedResult = $derived.by(() => {
    if (state.hasManualOverride) return state.manualOverride
    return syncResult !== undefined ? syncResult : staleAllowed ? state.lastResult : undefined
  })

  const isStale = $derived(
    !isSkipped &&
      syncResult === undefined &&
      staleAllowed &&
      !sameArgsAsLastResult &&
      resolvedResult !== undefined,
  )

  const data = $derived.by(() => {
    if (resolvedResult instanceof Error) return undefined
    return resolvedResult as FunctionReturnType<Query> | undefined
  })

  const error = $derived.by(() => {
    if (resolvedResult instanceof Error) return resolvedResult
    return undefined
  })

  // --- query key for withOverride ---
  const queryKey = getFunctionName(query)

  // --- public API ---
  return {
    // convex-svelte compat
    get data() {
      return data
    },
    get isLoading() {
      return isSkipped ? false : error === undefined && data === undefined
    },
    get error() {
      return error
    },
    get isStale() {
      return isSkipped ? false : isStale
    },

    // SvelteKit RemoteQuery compat
    get current() {
      return data
    },
    get loading() {
      return isSkipped ? false : error === undefined && data === undefined
    },
    get ready() {
      return data !== undefined
    },

    // Methods
    set(value: FunctionReturnType<Query>) {
      state.manualOverride = value
      state.hasManualOverride = true
    },

    async refresh() {
      state.refreshCounter++
    },

    withOverride(update: (current: FunctionReturnType<Query>) => FunctionReturnType<Query>): {
      _key: string
      release: () => void
    } {
      const currentData = data
      if (currentData !== undefined) {
        state.manualOverride = update(currentData)
        state.hasManualOverride = true
      }
      return {
        _key: queryKey,
        release: () => {
          state.hasManualOverride = false
        },
      }
    },
  } as ConvexQueryResult<Query>
}

// ============================================================================
// Detached query — works OUTSIDE component context (transport.decode, load fns)
// ============================================================================

/**
 * Seed a query outside component context, subscribing while rendered consumers
 * read it. Used by transport.decode and convexLoad() on client-side navigation.
 */
export function createDetachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
  initialData?: FunctionReturnType<Query>,
): ConvexQueryResult<Query> {
  const client = getConvexClient()
  const queryKey = getFunctionName(query)

  // $state works outside components — it compiles to raw signals
  let data: FunctionReturnType<Query> | undefined = $state(initialData)
  let error: Error | undefined = $state(undefined)
  let manualOverride: FunctionReturnType<Query> | undefined = $state(undefined)
  let hasManualOverride: boolean = $state(false)

  // Transport decoding also runs for preloaded pages. Subscribe only while
  // rendered consumers read this result, and release it when they leave.
  const subscribe = createSubscriber(() => {
    if (client.disabled) return
    return client.onUpdate(
      query,
      args,
      (result: FunctionReturnType<Query>) => {
        data = structuredClone(result)
        error = undefined
        hasManualOverride = false
      },
      (e: Error) => {
        error = e
        hasManualOverride = false
      },
    )
  })

  return {
    get data() {
      subscribe()
      if (hasManualOverride) return manualOverride
      return data
    },
    get isLoading() {
      subscribe()
      return error === undefined && data === undefined
    },
    get error() {
      subscribe()
      return error
    },
    get isStale() {
      return false
    },
    get current() {
      return this.data
    },
    get loading() {
      return this.isLoading
    },
    get ready() {
      subscribe()
      return data !== undefined
    },
    set(value: FunctionReturnType<Query>) {
      manualOverride = value
      hasManualOverride = true
    },
    async refresh() {
      // Detached queries can't easily re-subscribe; no-op for now
    },
    withOverride(update: (current: FunctionReturnType<Query>) => FunctionReturnType<Query>) {
      const currentData = data
      if (currentData !== undefined) {
        manualOverride = update(currentData)
        hasManualOverride = true
      }
      return {
        _key: queryKey,
        release: () => {
          hasManualOverride = false
        },
      }
    },
  } as ConvexQueryResult<Query>
}

// ============================================================================
// Helpers
// ============================================================================

function parseArgs<Query extends FunctionReference<"query">>(
  args: ArgsOrSkip<Query>,
): FunctionArgs<Query> | Skip {
  const resolved =
    typeof args === "function" ? (args as () => FunctionArgs<Query> | "skip")() : args
  if (resolved === "skip") return SKIP
  return $state.snapshot(resolved) as FunctionArgs<Query>
}

function parseOptions<Query extends FunctionReference<"query">>(
  options: ConvexQueryOptions<Query> | (() => ConvexQueryOptions<Query>),
): ConvexQueryOptions<Query> {
  const resolved = typeof options === "function" ? options() : options
  return $state.snapshot(resolved) as ConvexQueryOptions<Query>
}

function jsonEqualArgs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(convexToJson(a as never)) === JSON.stringify(convexToJson(b as never))
}

function argsKeyEqual<Query extends FunctionReference<"query">>(
  a: FunctionArgs<Query> | Skip,
  b: FunctionArgs<Query> | Skip,
): boolean {
  if (a === SKIP && b === SKIP) return true
  if (a === SKIP || b === SKIP) return false
  return jsonEqualArgs(a as Record<string, unknown>, b as Record<string, unknown>)
}
