import { ConvexError } from "convex/values"

export function convexErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError && typeof err.data === "object" && err.data !== null) {
    const data = err.data as { message?: string }
    if (data.message) return data.message
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}
