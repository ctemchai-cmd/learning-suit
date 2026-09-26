import { defineConfig, devices } from "playwright/test";

const externalURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalURL ?? "http://127.0.0.1:3100";

// Projects per plan06: Chromium (installed Google Chrome) and WebKit (Safari engine).
// Real trackpad/IME behaviour is still a manual check (MAN-01/MAN-02).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: externalURL ? undefined : {
    command: "corepack pnpm dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
