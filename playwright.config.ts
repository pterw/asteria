import { defineConfig } from "@playwright/test";

/**
 * Browser tests.
 *
 * These drive a built server against a throwaway embedded database, so a run leaves nothing
 * behind and needs no service to install. `reuseExistingServer` is on outside CI: while
 * working on the interface you will already have `npm run dev` open on port 3000, and a
 * config that insists on starting its own server just makes that workflow annoying.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  outputDir: "artifacts/test-results",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--no-sandbox"] },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://127.0.0.1:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ASTERIA_SECRET: process.env.ASTERIA_SECRET || "playwright-secret-playwright-secret",
          ASTERIA_DB: "pglite",
          ASTERIA_DB_DIR: process.env.ASTERIA_DB_DIR || ".asteria/e2e",
        },
      },
});
