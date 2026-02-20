import { describe, it, expect } from "vitest"
import { ConvexLoadResult, encodeConvexLoad } from "$lib/transport.svelte.js"

describe("ConvexLoadResult", () => {
  it("stores refName, args, and data", () => {
    const r = new ConvexLoadResult("api.tasks.list", { limit: 10 }, [{ id: "1" }])
    expect(r.refName).toBe("api.tasks.list")
    expect(r.args).toEqual({ limit: 10 })
    expect(r.data).toEqual([{ id: "1" }])
    expect(r.__convexLoad).toBe(true)
  })
})

describe("encodeConvexLoad", () => {
  it("encodes a ConvexLoadResult instance", () => {
    const r = new ConvexLoadResult("api.tasks.list", { limit: 10 }, ["data"])
    const encoded = encodeConvexLoad(r)
    expect(encoded).toEqual({
      refName: "api.tasks.list",
      args: { limit: 10 },
      data: ["data"],
    })
  })

  it("encodes a duck-typed object with __convexLoad marker", () => {
    const duck = { __convexLoad: true, refName: "api.foo", args: {}, data: 42 }
    const encoded = encodeConvexLoad(duck)
    expect(encoded).toEqual({ refName: "api.foo", args: {}, data: 42 })
  })

  it("returns false for non-matching values", () => {
    expect(encodeConvexLoad(null)).toBe(false)
    expect(encodeConvexLoad(undefined)).toBe(false)
    expect(encodeConvexLoad("string")).toBe(false)
    expect(encodeConvexLoad(123)).toBe(false)
    expect(encodeConvexLoad({})).toBe(false)
    expect(encodeConvexLoad({ data: "foo" })).toBe(false)
  })
})
