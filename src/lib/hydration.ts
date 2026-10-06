/**
 * Hands the Convex results a server render fetched to the browser's first render.
 *
 * SvelteKit serializes server load data (`+page.server.ts`), but it reruns
 * universal loads (`+page.ts`) in the browser to hydrate, before the Convex
 * client is authenticated. Without this bridge those loads find an empty cache
 * and the page swaps its server HTML for a loading state until the WebSocket
 * answers. The server writes what it fetched into the page head; the browser
 * reads it back only until the page is interactive, so it never masks newer data.
 */
import { convexToJson, jsonToConvex, type JSONValue, type Value } from "convex/values"

const ELEMENT_ID = "convex-hydration"

export interface RenderedQuery {
  refName: string
  args: Record<string, unknown>
  data: unknown
}

let currentRequest: (() => Set<RenderedQuery> | undefined) | undefined

/** Server: tell the bridge where the current request keeps its fetched results. */
export function recordServerQueriesWith(read: () => Set<RenderedQuery> | undefined): void {
  currentRequest = read
}

function requestRecord(): Set<RenderedQuery> | undefined {
  try {
    return currentRequest?.()
  } catch {
    // Outside a request (tests, scripts) there is no page to hydrate.
    return undefined
  }
}

/** Server: remember a result so the page head can carry it to the browser. */
export function recordServerQuery(result: RenderedQuery): void {
  requestRecord()?.add(result)
}

/** Server: SvelteKit already serializes this result with the load data. */
export function forgetServerQuery(result: RenderedQuery): void {
  requestRecord()?.delete(result)
}

function keyOf(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(convexToJson(args as Value))}`
}

/** Server: the `<script>` that carries a render's results, or "" when there are none. */
export function hydrationScript(rendered: Iterable<RenderedQuery>): string {
  const entries: [string, JSONValue][] = []
  for (const { refName, args, data } of rendered) {
    try {
      entries.push([keyOf(refName, args), convexToJson(data as Value)])
    } catch {
      // A value Convex cannot encode is simply fetched again by the browser.
    }
  }
  if (!entries.length) return ""
  // `<` is escaped so no string in the data can close the element early.
  const json = JSON.stringify(entries).replace(/</g, "\\u003c")
  return `<script type="application/json" id="${ELEMENT_ID}">${json}</script>`
}

let parsed: { source: string; values: Map<string, JSONValue> } | undefined

/**
 * Browser: the server's value for this query while the first render hydrates,
 * otherwise `undefined`.
 */
export function hydratedQueryResult(name: string, args: unknown): unknown {
  const document = globalThis.document
  if (!document || document.body?.hasAttribute("data-hydrated")) {
    parsed = undefined
    return undefined
  }
  const source = document.getElementById(ELEMENT_ID)?.textContent
  if (!source) return undefined
  if (parsed?.source !== source) {
    try {
      parsed = { source, values: new Map(JSON.parse(source) as [string, JSONValue][]) }
    } catch {
      return undefined
    }
  }
  let key: string
  try {
    key = keyOf(name, args)
  } catch {
    return undefined
  }
  const value = parsed.values.get(key)
  return value === undefined ? undefined : jsonToConvex(value)
}
