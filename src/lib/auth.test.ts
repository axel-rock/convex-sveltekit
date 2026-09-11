import { describe, expect, it, vi } from "vitest"
import { createAuthBridge } from "./auth.svelte"

function setup() {
  const setAuth = vi.fn()
  const clearAuth = vi.fn()
  const token = vi.fn()
  const onChange = vi.fn()
  const bridge = createAuthBridge(
    { setAuth, client: { clearAuth } } as never,
    { convex: { token } } as never,
    onChange,
  )
  return { bridge, setAuth, clearAuth, token, onChange }
}

describe("sign-in token handoff", () => {
  it("uses the returned server token after signing in from an anonymous page", async () => {
    const { bridge, setAuth, token } = setup()
    bridge(null)
    bridge("signed-in-token")
    const fetchToken = setAuth.mock.calls[0]![0]
    // 563c4835 kept initialToken=null after goto, forcing another HTTP request.
    await expect(fetchToken({ forceRefreshToken: false })).resolves.toBe("signed-in-token")
    expect(token).not.toHaveBeenCalled()
  })

  it("does not restart authentication when the same layout identity renders again", () => {
    const { bridge, setAuth } = setup()
    bridge("server-token")
    bridge("server-token")
    expect(setAuth).toHaveBeenCalledOnce()
  })

  it("refreshes only when Convex asks and stops on a revoked session", async () => {
    const { bridge, setAuth, token } = setup()
    bridge("server-token")
    const fetchToken = setAuth.mock.calls[0]![0]
    token.mockResolvedValueOnce({ data: { token: "refreshed-token" } })
    await expect(fetchToken({ forceRefreshToken: true })).resolves.toBe("refreshed-token")
    token.mockResolvedValueOnce({ data: null })
    await expect(fetchToken({ forceRefreshToken: true })).resolves.toBeNull()
    expect(token).toHaveBeenCalledTimes(2)
  })

  it("discards an in-flight token and confirmation after sign-out", async () => {
    const { bridge, setAuth, clearAuth, token, onChange } = setup()
    const response = Promise.withResolvers<{ data: { token: string } }>()
    token.mockReturnValue(response.promise)
    bridge("signed-in-token")
    const [fetchToken, confirm] = setAuth.mock.calls[0]!
    const refresh = fetchToken({ forceRefreshToken: true })
    bridge(null)
    expect(clearAuth).toHaveBeenCalledOnce()
    response.resolve({ data: { token: "obsolete-token" } })
    await expect(refresh).resolves.toBeNull()
    confirm(true)
    expect(onChange).not.toHaveBeenCalledWith(true)
  })

  it("cannot apply the previous workspace's confirmation after switching", () => {
    const { bridge, setAuth, onChange } = setup()
    bridge("first-workspace-token")
    const firstConfirmation = setAuth.mock.calls[0]![1]
    bridge("second-workspace-token")
    firstConfirmation(true)
    expect(onChange).not.toHaveBeenCalledWith(true)
    setAuth.mock.calls[1]![1](true)
    expect(onChange).toHaveBeenLastCalledWith(true)
  })
})
