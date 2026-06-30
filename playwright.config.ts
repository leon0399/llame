import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.E2E_WEB_PORT ?? "4300";
const apiPort = process.env.E2E_API_PORT ?? "4301";
const dbPort = process.env.E2E_DB_PORT ?? "55433";
const dbReadyPort = process.env.E2E_DB_READY_PORT ?? "4302";
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;
const dbReadyUrl = `http://localhost:${dbReadyPort}/ready`;
const startDatabase = !process.env.POSTGRES_URL;
const postgresUrl =
  process.env.POSTGRES_URL ??
  `postgres://app:app@localhost:${dbPort}/llame_e2e`;

function env(name: string, value: string): string {
  return `${name}=${JSON.stringify(value)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function waitForUrl(url: string): string {
  const script = `
const url = ${JSON.stringify(url)};
const timeout = Date.now() + 120_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (Date.now() < timeout) {
  try {
    const response = await fetch(url);
    if (response.ok) process.exit(0);
  } catch {
  }

  await sleep(500);
}

console.error("Timed out waiting for " + url);
process.exit(1);
`;

  return `node -e ${shellQuote(script)}`;
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
    ...(startDatabase
      ? [
          {
            name: "db",
            command: [
              env("E2E_DB_PORT", dbPort),
              env("E2E_DB_READY_PORT", dbReadyPort),
              env(
                "E2E_DB_CONTAINER",
                process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres",
              ),
              env(
                "E2E_DB_PG_IMAGE",
                process.env.E2E_DB_PG_IMAGE ?? "postgres:17-alpine",
              ),
              env("POSTGRES_URL", postgresUrl),
              "exec node --import tsx e2e/db-server.ts",
            ].join(" "),
            url: dbReadyUrl,
            timeout: 180_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
            stdout: "pipe",
            stderr: "pipe",
          },
        ]
      : []),
    {
      name: "api",
      command: [
        ...(startDatabase ? [`${waitForUrl(dbReadyUrl)} &&`] : []),
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
