import { defineConfig, devices } from "playwright/test";

// PERF-01..03 automated benchmark (Retina DPR 2, installed Chrome). Not part of `pnpm test:e2e`.
export default defineConfig({
  testDir: "./tests/perf",
  timeout: 240_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"], channel: "chrome", deviceScaleFactor: 2, viewport: { width: 1440, height: 900 },
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "corepack pnpm dev --hostname 127.0.0.1 --port 3100", url: "http://127.0.0.1:3100", timeout: 120_000, reuseExistingServer: true,
  },
});
