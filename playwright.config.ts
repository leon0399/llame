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
const modelPort = readPort("E2E_MODEL_PORT", "4303");
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
    // CI Chromium ships an empty navigator.language; anything calling
    // new Intl.Locale(...) with it (e.g. TanStack Query devtools under
    // next dev) throws RangeError and can wreck hydration for the page.
    locale: "en-US",
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
      // Deterministic OpenAI-compatible mock (#80): the api streams real
      // answers through the real loop with zero provider spend.
      name: "model",
      command: "node --import tsx e2e/model-server.ts",
      env: webServerEnv({ E2E_MODEL_PORT: modelPort }),
      url: `http://localhost:${modelPort}/ready`,
      // 60s (was 30s): a tsx cold-start under load — e.g. right after another
      // suite tore its servers down — can miss a 30s /ready window and abort
      // the whole run before any test. The server itself starts fine.
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
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
        // Chat browser flows (#80) run against the mock model server, and the
        // whole browser suite runs in worker execution mode — the durability
        // architecture (#48/#50) soaks under every UI interaction, and the
        // resume flow (#49) is testable end-to-end.
        OPENAI_API_KEY: "e2e-mock-key",
        // Many parallel browser workers register + log in from one IP; the
        // production-strict per-IP auth throttle would starve the fixtures.
        AUTH_RATE_LIMIT_PER_MINUTE: "1000",
        OPENAI_BASE_URL: `http://localhost:${modelPort}/v1`,
        OPENAI_MODEL: "e2e-mock",
        RUN_EXECUTION_MODE: "worker",
        // Enable the BYOK vault (#18) so the browser suite can exercise the
        // full provider-account → model-selection → chat path. Test-only key.
        CREDENTIAL_MASTER_KEYS:
          "1:ZTJlLXRlc3QtbWFzdGVyLWtleS0tMzItYnl0ZXMhISE=",
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
