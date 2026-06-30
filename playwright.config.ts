import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.E2E_WEB_PORT ?? "4300";
const apiPort = process.env.E2E_API_PORT ?? "4301";
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;
const postgresUrl =
  process.env.POSTGRES_URL ?? "postgres://app:app@localhost:5432/llame";

function env(name: string, value: string): string {
  return `${name}=${JSON.stringify(value)}`;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      name: "api",
      command: [
        env("NODE_ENV", "development"),
        env("PORT", apiPort),
        env("POSTGRES_URL", postgresUrl),
        env("WEB_ORIGIN", webUrl),
        env("SESSION_COOKIE_DOMAIN", ""),
        "pnpm --filter api dev",
      ].join(" "),
      url: apiUrl,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      command: [
        env("NODE_ENV", "development"),
        env("NEXT_PUBLIC_API_URL", apiUrl),
        `pnpm --filter web exec next dev --turbopack --hostname localhost --port ${webPort}`,
      ].join(" "),
      url: `${webUrl}/login`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
