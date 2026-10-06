import { afterEach, describe, expect, it, vi } from "vitest"
import { makeFunctionReference } from "convex/server"
import { AsyncLocalStorage } from "node:async_hooks"
// Exercise real subscription teardown without mounting a DOM; application code uses public APIs.
// eslint-disable-next-line svelte/no-svelte-internal
import { effect_root, render_effect } from "svelte/internal/client"

const { client } = vi.hoisted(() => ({
  client: {
    disabled: false,
    onUpdate: vi.fn(() => vi.fn()),
    query: vi.fn(),
    client: { localQueryResult: vi.fn(), hasAuth: vi.fn(() => true) },
  },
}))

vi.mock("./client.svelte.js", () => ({ getConvexClient: () => client }))
vi.mock("$app/environment", () => ({ browser: true }))
// These are browser lifecycle tests without a DOM. Use Svelte's real client
// subscriber; the node-condition export deliberately does nothing during SSR.
vi.mock("svelte/reactivity", async () => {
  const entry = new URL(
    "./src/reactivity/index-client.js",
    import.meta.resolve("svelte/package.json"),
  )
  return import(/* @vite-ignore */ entry.href)
})

import { createDetachedQuery, WARM_SUBSCRIPTION_MS } from "./query.svelte"
import { decodeConvexUser } from "./user.svelte"
import { convexLoad, decodeConvexLoad } from "./transport.svelte"

const query = makeFunctionReference<"query", Record<string, never>, string>("test:current")
const cleanup: Array<() => void> = []

afterEach(async () => {
  cleanup.splice(0).forEach((stop) => stop())
  await Promise.resolve()
  client.onUpdate.mockReset().mockImplementation(() => vi.fn())
  client.query.mockReset()
  client.client.localQueryResult.mockReset()
  client.client.hasAuth.mockReset().mockReturnValue(true)
  client.disabled = false
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function observe(read: () => unknown) {
  const stop = effect_root(() => render_effect(read))
  cleanup.push(stop)
  return stop
}

describe("page subscription lifetime", () => {
  it("does not subscribe for a preloaded page that is never displayed", () => {
    const result = createDetachedQuery(query, {}, "server value")
    expect(result.data).toBe("server value")
    expect(client.onUpdate).not.toHaveBeenCalled()
  })

  it("keeps a page you left warm for a few seconds, then releases it", async () => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn()
    client.onUpdate.mockReturnValue(unsubscribe)
    const result = createDetachedQuery(query, {}, "server value")
    const first = observe(() => result.data)
    const second = observe(() => result.isLoading)
    expect(client.onUpdate).toHaveBeenCalledTimes(1)
    first()
    await Promise.resolve()
    second()
    await Promise.resolve()
    // Going back within the window finds the result still in the client cache.
    vi.advanceTimersByTime(WARM_SUBSCRIPTION_MS - 1)
    expect(unsubscribe).not.toHaveBeenCalled()
    // 7555f2c9a discarded onUpdate's disposer, retaining every visited page.
    vi.advanceTimersByTime(1)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("releases the live user when a refreshed layout replaces it", async () => {
    const unsubscribe = vi.fn()
    client.onUpdate.mockReturnValue(unsubscribe)
    const user = decodeConvexUser({ data: { id: "fictional-user", name: "Alex" } }, query, {})
    const stop = observe(() => user.name)
    expect(client.onUpdate).toHaveBeenCalledOnce()
    stop()
    await Promise.resolve()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("does not start a live subscription on a disabled server client", () => {
    client.disabled = true
    const result = createDetachedQuery(query, {}, "server value")
    observe(() => result.data)
    expect(result.data).toBe("server value")
    expect(client.onUpdate).not.toHaveBeenCalled()
  })

  it("uses the authenticated client and its cached result on navigation", async () => {
    client.client.localQueryResult.mockReturnValue("cached value")
    const result = await convexLoad(query, {})
    expect(client.client.localQueryResult).toHaveBeenCalledWith("test:current", {})
    expect(client.query).not.toHaveBeenCalled()
    expect(result.data).toBe("cached value")
    expect(client.onUpdate).not.toHaveBeenCalled()
  })
})

it("reads each server request's token without retaining another user's identity", async () => {
  const { initConvex, getServerConvexToken } =
    await vi.importActual<typeof import("./client.svelte")>("./client.svelte")
  const requestToken = new AsyncLocalStorage<string>()
  initConvex("https://fictional.convex.cloud", {}, () => requestToken.getStore() ?? null)
  const release = Promise.withResolvers<void>()
  const firstRequest = requestToken.run("first-user-token", async () => {
    await release.promise
    return getServerConvexToken()
  })
  const secondRequest = requestToken.run("second-user-token", async () => {
    release.resolve()
    return getServerConvexToken()
  })
  await expect(firstRequest).resolves.toBe("first-user-token")
  await expect(secondRequest).resolves.toBe("second-user-token")
  expect(getServerConvexToken()).toBeNull()
})

describe("billing navigation authentication", () => {
  it("recovers when authentication arrives after the checkout return loads", async () => {
    // 58c84b78a awaited an anonymous request before layout auth could mount.
    client.client.localQueryResult.mockImplementation(() => {
      throw new Error("Unauthenticated")
    })
    const result = await convexLoad(query, {})
    expect(client.query).not.toHaveBeenCalled()
    expect(result.isLoading).toBe(true)
    const stop = observe(() => result.data)
    const [, , receive, fail] = client.onUpdate.mock.lastCall!
    fail(new Error("Unauthenticated"))
    expect(result.error?.message).toBe("Unauthenticated")
    receive("authenticated billing")
    expect(result.data).toBe("authenticated billing")
    expect(result.error).toBeUndefined()
    expect(result.isLoading).toBe(false)
    stop()
  })

  it("removes a hydrated billing value when access is revoked", () => {
    const result = decodeConvexLoad({ refName: "billing:get", args: {}, data: "billing" })
    observe(() => result.data)
    expect(result.data).toBe("billing")
    const [, , , fail] = client.onUpdate.mock.lastCall!
    fail(new Error("Forbidden"))
    expect(result.data).toBeUndefined()
    expect(result.error?.message).toBe("Forbidden")
    expect(result.isLoading).toBe(false)
  })
})

describe("thread navigation data", () => {
  function hydratedPage() {
    vi.stubGlobal("document", { body: { hasAttribute: () => true } })
  }
  /** Answer the latest subscription, the way the Convex server would. */
  function answer(value: unknown) {
    client.onUpdate.mock.lastCall![2](value)
  }

  it("keeps the current page until an uncached thread can render", async () => {
    hydratedPage()
    let settled = false
    const loading = convexLoad(query, {}, { waitForData: true }).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    // b124b774e committed the new route before requesting its thread data.
    expect(settled).toBe(false)
    answer("authorized conversation")
    expect((await loading).data).toBe("authorized conversation")
  })

  it("reuses a cached thread without waiting for the server", async () => {
    hydratedPage()
    client.client.localQueryResult.mockReturnValue("cached conversation")
    expect((await convexLoad(query, {}, { waitForData: true })).data).toBe("cached conversation")
    expect(client.query).not.toHaveBeenCalled()
  })

  it("still lets layout authentication mount before the first request", async () => {
    vi.stubGlobal("document", { body: { hasAttribute: () => false }, getElementById: () => null })
    const result = await convexLoad(query, {}, { waitForData: true })
    expect(result.isLoading).toBe(true)
    expect(client.query).not.toHaveBeenCalled()
    expect(client.onUpdate).not.toHaveBeenCalled()
  })

  it("does not wait for anonymous data while a sign-in navigation installs authentication", async () => {
    hydratedPage()
    client.client.hasAuth.mockReturnValue(false)
    const result = await convexLoad(query, {}, { waitForData: true })
    expect(result.isLoading).toBe(true)
    expect(client.onUpdate).not.toHaveBeenCalled()
    observe(() => result.data)
    answer("signed-in conversation")
    expect(result.data).toBe("signed-in conversation")
  })

  it("clears the loaded conversation when the live subscription revokes access", async () => {
    hydratedPage()
    const loading = convexLoad(query, {}, { waitForData: true })
    answer("authorized conversation")
    const result = await loading
    observe(() => result.data)
    client.onUpdate.mock.lastCall![3](new Error("Forbidden"))
    expect(result.data).toBeUndefined()
    expect(result.error?.message).toBe("Forbidden")
  })

  it("does not hide a failed authorization check behind a cached page", async () => {
    hydratedPage()
    const loading = convexLoad(query, {}, { waitForData: true })
    client.onUpdate.mock.lastCall![3](new Error("Forbidden"))
    await expect(loading).rejects.toThrow("Forbidden")
  })

  it("hands its subscription to the page instead of dropping and reopening it", async () => {
    // client.query() unsubscribed on the first value, so the page's own
    // subscription asked the server for the same thread a second time.
    vi.useFakeTimers()
    hydratedPage()
    const unsubscribe = vi.fn()
    client.onUpdate.mockReturnValue(unsubscribe)
    const loading = convexLoad(query, {}, { waitForData: true })
    answer("conversation")
    const result = await loading
    expect(unsubscribe).not.toHaveBeenCalled()
    observe(() => result.data)
    expect(client.onUpdate).toHaveBeenCalledTimes(2)
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(client.query).not.toHaveBeenCalled()
    vi.advanceTimersByTime(WARM_SUBSCRIPTION_MS)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("releases a hovered thread that is never opened", async () => {
    vi.useFakeTimers()
    hydratedPage()
    const unsubscribe = vi.fn()
    client.onUpdate.mockReturnValue(unsubscribe)
    const loading = convexLoad(query, {}, { waitForData: true })
    answer("conversation")
    await loading
    vi.advanceTimersByTime(WARM_SUBSCRIPTION_MS - 1)
    expect(unsubscribe).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("does not report a failed preload nobody waits for", async () => {
    hydratedPage()
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    await convexLoad(query, {})
    client.onUpdate.mock.lastCall![3](new Error("Forbidden"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off("unhandledRejection", unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it("serves the server-rendered thread while the page hydrates, without a request", async () => {
    // The thread page replaced its server HTML with "Opening thread…" on every
    // full load: the hydrating load found an empty cache and did not wait.
    const json = JSON.stringify([["test:current:{}", "server conversation"]])
    vi.stubGlobal("document", {
      body: { hasAttribute: () => false },
      getElementById: () => ({ textContent: json }),
    })
    const result = await convexLoad(query, {}, { waitForData: true })
    expect(result.data).toBe("server conversation")
    expect(client.onUpdate).not.toHaveBeenCalled()
    expect(client.client.localQueryResult).not.toHaveBeenCalled()
  })
})
