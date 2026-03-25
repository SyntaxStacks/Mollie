import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.UI_E2E_WEB_PORT ?? process.env.WEB_PORT ?? 3100);
const apiPort = Number(process.env.UI_E2E_API_PORT ?? process.env.API_PORT ?? 4100);
const baseURL = process.env.APP_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: "pnpm exec tsx infra/scripts/ui-api-server.ts",
      url: `${apiBaseUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: "node infra/scripts/ui-web-server.mjs",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000
    }
  ]
});
