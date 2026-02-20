import { test, expect } from "@playwright/test"

test.describe("Server-side demo", () => {
  test("renders task list without loading spinner (SSR)", async ({ page }) => {
    const response = await page.goto("/demo/server")
    expect(response?.status()).toBe(200)

    // SSR page should NOT show the loading spinner — data is pre-fetched
    await expect(page.locator(".loading")).not.toBeVisible()

    // Status bar should be visible and show server mode
    await expect(page.locator(".status")).toContainText("mode:")
    await expect(page.locator(".mode-server")).toBeVisible()
  })

  test("SSR HTML contains task data (no client-side fetch needed)", async ({ request }) => {
    const response = await request.get("/demo/server")
    const html = await response.text()
    // The task list or empty state should be in the initial HTML
    expect(html).toMatch(/task-list|No tasks yet/)
  })

  test("can add and remove a task", async ({ page }) => {
    await page.goto("/demo/server")

    const taskText = `e2e-test-${Date.now()}`
    await page.fill(".demo-input", taskText)
    await page.click('button[type="submit"]')

    // Task should appear in the list
    await expect(page.locator(".task-text", { hasText: taskText })).toBeVisible({ timeout: 10_000 })

    // Delete the task
    const taskItem = page.locator(".task-item", {
      has: page.locator(".task-text", { hasText: taskText }),
    })
    await taskItem.locator(".task-delete").click()

    // Task should disappear
    await expect(page.locator(".task-text", { hasText: taskText })).not.toBeVisible({
      timeout: 10_000,
    })
  })
})

test.describe("Client-side demo", () => {
  test("shows loading state then renders tasks", async ({ page }) => {
    await page.goto("/demo/client")

    // Should eventually show the task list or empty state
    await expect(page.locator(".task-list, .empty")).toBeVisible({ timeout: 15_000 })

    await expect(page.locator(".mode-client")).toBeVisible()
  })
})

test.describe("Auth demo", () => {
  test("shows sign-in form when not authenticated", async ({ page }) => {
    await page.goto("/demo/auth")
    await expect(page.locator("text=Sign in")).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test("can toggle between sign-in and sign-up", async ({ page }) => {
    await page.goto("/demo/auth")
    await expect(page.locator("h2")).toContainText("Sign in")

    await page.click("text=Sign up")
    await expect(page.locator("h2")).toContainText("Create account")
    await expect(page.locator('input[placeholder="Name"]')).toBeVisible()

    await page.click("text=Sign in")
    await expect(page.locator("h2")).toContainText("Sign in")
  })
})
