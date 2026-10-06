import { afterEach, describe, expect, it, vi } from "vitest"

import {
  forgetServerQuery,
  hydratedQueryResult,
  hydrationScript,
  recordServerQueriesWith,
  recordServerQuery,
} from "./hydration"

type Rendered = Parameters<typeof recordServerQuery>[0]

afterEach(() => {
  vi.unstubAllGlobals()
  recordServerQueriesWith(() => undefined)
})

/** Serve the script a server render wrote, the way the browser would parse it. */
function browserWith(script: string, { hydrated = false } = {}) {
  const json = /<script[^>]*>([\s\S]*)<\/script>/.exec(script)?.[1]
  vi.stubGlobal("document", {
    getElementById: (id: string) =>
      id === "convex-hydration" && json !== undefined ? { textContent: json } : null,
    body: { hasAttribute: (name: string) => name === "data-hydrated" && hydrated },
  })
}

function renderedRequest() {
  const rendered = new Set<Rendered>()
  recordServerQueriesWith(() => rendered)
  return rendered
}

const thread = { refName: "thread:get", args: { threadId: "fictional-thread" } }

describe("server-rendered query results reach the browser's first render", () => {
  it("serves the thread the server rendered while the page hydrates", () => {
    // Before this bridge, the thread page's universal load found an empty
    // client cache on hydration and replaced the server HTML with "Opening thread…".
    const rendered = renderedRequest()
    recordServerQuery({ ...thread, data: { title: "Tender review", messages: 3 } })
    browserWith(hydrationScript(rendered))
    expect(hydratedQueryResult(thread.refName, thread.args)).toEqual({
      title: "Tender review",
      messages: 3,
    })
  })

  it("never serves server data once the page is interactive", () => {
    const rendered = renderedRequest()
    recordServerQuery({ ...thread, data: { title: "Old title" } })
    browserWith(hydrationScript(rendered), { hydrated: true })
    expect(hydratedQueryResult(thread.refName, thread.args)).toBeUndefined()
  })

  it("does not match another query or other arguments", () => {
    const rendered = renderedRequest()
    recordServerQuery({ ...thread, data: { title: "Tender review" } })
    browserWith(hydrationScript(rendered))
    expect(hydratedQueryResult(thread.refName, { threadId: "another-thread" })).toBeUndefined()
    expect(hydratedQueryResult("message:listForThread", thread.args)).toBeUndefined()
  })

  it("does not write a result twice when server load data already carries it", () => {
    const rendered = renderedRequest()
    const transported = { refName: "project:list", args: {}, data: [{ name: "Carried" }] }
    recordServerQuery(transported)
    recordServerQuery({ ...thread, data: { title: "Tender review" } })
    forgetServerQuery(transported)
    const script = hydrationScript(rendered)
    expect(script).not.toContain("Carried")
    expect(script).toContain("Tender review")
  })

  it("keeps Convex types such as 64-bit integers", () => {
    const rendered = renderedRequest()
    recordServerQuery({ ...thread, data: { tokens: 9_007_199_254_740_993n } })
    browserWith(hydrationScript(rendered))
    expect(hydratedQueryResult(thread.refName, thread.args)).toEqual({
      tokens: 9_007_199_254_740_993n,
    })
  })

  it("does not let user content close the script element", () => {
    const rendered = renderedRequest()
    const title = "</script><script>alert(1)</script>"
    recordServerQuery({ ...thread, data: { title } })
    const script = hydrationScript(rendered)
    expect(script.match(/<\/script>/g)).toHaveLength(1)
    browserWith(script)
    expect(hydratedQueryResult(thread.refName, thread.args)).toEqual({ title })
  })

  it("writes nothing when the render fetched nothing", () => {
    expect(hydrationScript(renderedRequest())).toBe("")
  })

  it("ignores results fetched outside a page request", () => {
    recordServerQueriesWith(() => {
      throw new Error("Can only read the current request event inside a request")
    })
    expect(() => recordServerQuery({ ...thread, data: null })).not.toThrow()
  })
})
