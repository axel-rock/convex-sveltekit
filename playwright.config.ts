import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5173",
    screenshot: "only-on-failure",
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        port: 5173,
        reuseExistingServer: true,
      },
})
