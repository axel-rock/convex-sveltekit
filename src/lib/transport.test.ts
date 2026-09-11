import { afterEach, describe, expect, it, vi } from "vitest"
import { makeFunctionReference } from "convex/server"
import { AsyncLocalStorage } from "node:async_hooks"
// Exercise real subscription teardown without mounting a DOM; application code uses public APIs.
// eslint-disable-next-line svelte/no-svelte-internal
import { effect_root, render_effect } from "svelte/internal/client"

const { client } = vi.hoisted(() => ({
  client: {
    disabled: false,
    onUpdate: vi.fn(),
    query: vi.fn(),
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

import { createDetachedQuery } from "./query.svelte"
import { decodeConvexUser } from "./user.svelte"
import { convexLoad } from "./transport.svelte"

const query = makeFunctionReference<"query", Record<string, never>, string>("test:current")
const cleanup: Array<() => void> = []

afterEach(async () => {
  cleanup.splice(0).forEach((stop) => stop())
  await Promise.resolve()
  client.onUpdate.mockReset()
  client.query.mockReset()
  client.disabled = false
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

  it("releases the subscription after the last displayed consumer leaves", async () => {
    const unsubscribe = vi.fn()
    client.onUpdate.mockReturnValue(unsubscribe)
    const result = createDetachedQuery(query, {}, "server value")
    const first = observe(() => result.data)
    const second = observe(() => result.isLoading)
    expect(client.onUpdate).toHaveBeenCalledTimes(1)
    first()
    await Promise.resolve()
    expect(unsubscribe).not.toHaveBeenCalled()
    second()
    await Promise.resolve()
    // 7555f2c9a discarded onUpdate's disposer, retaining every visited page.
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
    client.query.mockResolvedValue("cached value")
    const result = await convexLoad(query, {})
    expect(client.query).toHaveBeenCalledWith(query, {})
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
