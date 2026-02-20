import { describe, it, expect } from "vitest"
import { ConvexUserResult, encodeConvexUser, convexUser } from "$lib/user.svelte.js"

describe("ConvexUserResult", () => {
  it("assigns data fields onto the instance", () => {
    const r = new ConvexUserResult({ id: "u1", email: "a@b.c", name: "Alice" })
    const obj = r as unknown as Record<string, unknown>
    expect(obj.id).toBe("u1")
    expect(obj.email).toBe("a@b.c")
    expect(obj.name).toBe("Alice")
    expect(r.__convexUser).toBe(true)
  })
})

describe("encodeConvexUser", () => {
  it("encodes a ConvexUserResult instance, stripping the marker", () => {
    const r = new ConvexUserResult({ id: "u1", email: "a@b.c", name: "Alice", image: null })
    const encoded = encodeConvexUser(r)
    expect(encoded).toEqual({
      data: { id: "u1", email: "a@b.c", name: "Alice", image: null },
    })
  })

  it("encodes a duck-typed object with __convexUser marker", () => {
    const duck = { __convexUser: true, id: "u2", name: "Bob", email: "b@c.d" }
    const encoded = encodeConvexUser(duck)
    expect(encoded).not.toBe(false)
    expect((encoded as { data: Record<string, unknown> }).data.id).toBe("u2")
    expect((encoded as { data: Record<string, unknown> }).data.__convexUser).toBeUndefined()
  })

  it("returns false for non-matching values", () => {
    expect(encodeConvexUser(null)).toBe(false)
    expect(encodeConvexUser(undefined)).toBe(false)
    expect(encodeConvexUser("string")).toBe(false)
    expect(encodeConvexUser({ id: "u1" })).toBe(false)
  })
})

describe("convexUser", () => {
  it("returns null for falsy input", () => {
    expect(convexUser(null)).toBeNull()
    expect(convexUser(undefined)).toBeNull()
  })

  it("wraps truthy input in a ConvexUserResult", () => {
    const user = { id: "u1", email: "a@b.c", name: "Alice" }
    const result = convexUser(user)
    expect(result).not.toBeNull()
    expect(encodeConvexUser(result)).not.toBe(false)
  })

  it("preserves all fields through encode round-trip", () => {
    const user = { id: "u1", email: "a@b.c", name: "Alice", image: "https://img.co/1" }
    const wrapped = convexUser(user)
    const encoded = encodeConvexUser(wrapped) as { data: Record<string, unknown> }
    expect(encoded.data).toEqual(user)
  })
})
