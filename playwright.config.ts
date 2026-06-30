import { defineConfig, devices } from "@playwright/test";

function readPort(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a TCP port number`);
  }

  return String(port);
}

const webPort = readPort("E2E_WEB_PORT", "4300");
const apiPort = readPort("E2E_API_PORT", "4301");
const dbPort = readPort("E2E_DB_PORT", "55433");
const dbReadyPort = readPort("E2E_DB_READY_PORT", "4302");
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;
const dbReadyUrl = `http://localhost:${dbReadyPort}/ready`;
const startDatabase = !process.env.POSTGRES_URL;
const postgresUrl =
  process.env.POSTGRES_URL ??
  `postgres://app:app@localhost:${dbPort}/llame_e2e`;
const processEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);

function webServerEnv(
  overrides: Record<string, string>,
): Record<string, string> {
  return { ...processEnv, ...overrides };
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
            command: "node --import tsx e2e/db-server.ts",
            env: webServerEnv({
              E2E_DB_PORT: dbPort,
              E2E_DB_READY_PORT: dbReadyPort,
              E2E_DB_CONTAINER:
                process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres",
              E2E_DB_PG_IMAGE:
                process.env.E2E_DB_PG_IMAGE ?? "postgres:17-alpine",
              POSTGRES_URL: postgresUrl,
            }),
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
      command: startDatabase
        ? `node --import tsx e2e/run-after-ready.ts ${dbReadyUrl} pnpm --filter api dev`
        : "pnpm --filter api dev",
      env: webServerEnv({
        NODE_ENV: "development",
        PORT: apiPort,
        POSTGRES_URL: postgresUrl,
        WEB_ORIGIN: webUrl,
        SESSION_COOKIE_DOMAIN: "",
      }),
      url: apiUrl,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      command: `pnpm --filter web exec next dev --turbopack --hostname localhost --port ${webPort}`,
      env: webServerEnv({
        NODE_ENV: "development",
        NEXT_PUBLIC_API_URL: apiUrl,
      }),
      url: `${webUrl}/login`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
