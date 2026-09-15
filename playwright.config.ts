import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", timeout: 45_000, expect: { timeout: 8_000 }, fullyParallel: false,
  workers: 1, reporter: "list", outputDir: "artifacts/test-results",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000", viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions: { args: ["--no-sandbox"] } },
});
