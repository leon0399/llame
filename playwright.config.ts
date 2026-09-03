import path from "node:path";
import { tmpdir } from "node:os";

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
const mcpPort = readPort("E2E_MCP_PORT", "4304");
// One test-only operator root is shared by the co-located API/worker process;
// each Playwright worker gets an isolated stable-ID child beneath it.
const knowledgeRoot =
  process.env.E2E_KNOWLEDGE_ROOT ??
  path.join(tmpdir(), `llame-e2e-knowledge-${process.pid}`);
process.env.E2E_KNOWLEDGE_ROOT = knowledgeRoot;
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

function webServerEnv(overrides: Record<string, string>) {
  return {
    ...processEnv,
    // Node >=21 derives navigator.language from the process locale; with LANG
    // unset, C, or C.UTF-8 (the WSL default) it reports an invalid tag and
    // `new Intl.Locale(...)` throws during SSR (seen via TanStack Query
    // devtools during server rendering). CI forces this at the job level —
    // forcing it here too makes local runs match CI instead of inheriting the
    // shell's locale. Browser-side locale is pinned separately via `use.locale`.
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    ...overrides,
  };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retries preserve diagnostics for timing-sensitive failures; they do not
  // turn a flaky test into a passing CI signal.
  failOnFlakyTests: !!process.env.CI,
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
    // server rendering) throws RangeError and can wreck hydration for the page.
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
            command: "node --import tsx e2e/support/db-server.ts",
            env: webServerEnv({
              E2E_DB_PORT: dbPort,
              E2E_DB_READY_PORT: dbReadyPort,
              E2E_DB_CONTAINER:
                process.env.E2E_DB_CONTAINER ?? "llame-e2e-postgres",
              E2E_DB_PG_IMAGE:
                process.env.E2E_DB_PG_IMAGE ??
                "pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f",
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
      // Deterministic Streamable HTTP MCP fixture: production client/runtime,
      // local fixed evidence, no provider credentials or external network.
      name: "mcp",
      command: "node --import tsx e2e/support/mcp-server.ts",
      env: webServerEnv({ E2E_MCP_PORT: mcpPort }),
      url: `http://localhost:${mcpPort}/ready`,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Deterministic OpenAI-compatible mock (#80): the api streams real
      // answers through the real loop with zero provider spend.
      name: "model",
      command: "node --import tsx e2e/support/model-server.ts",
      env: webServerEnv({ E2E_MODEL_PORT: modelPort }),
      url: `http://localhost:${modelPort}/ready`,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "api",
      command: startDatabase
        ? `node --import tsx e2e/support/run-after-ready.ts ${dbReadyUrl} pnpm --filter api dev`
        : "pnpm --filter api dev",
      env: webServerEnv({
        NODE_ENV: "development",
        PORT: apiPort,
        POSTGRES_URL: postgresUrl,
        WEB_ORIGIN: webUrl,
        SESSION_COOKIE_DOMAIN: "",
        // Chat flows run against the mock model server through the real
        // pg-boss queue; its e2e concurrency lives in llame.config.e2e.json.
        OPENAI_API_KEY: "e2e-mock-key",
        // Many parallel browser workers register + log in from one IP; the
        // production-strict per-IP throttles would starve the fixtures. The
        // auth ceiling covers /auth/v1 register+login; the API ceiling covers
        // everything else (page loads, history fetches, run polling), which
        // the whole matrix shares from localhost.
        AUTH_RATE_LIMIT_PER_MINUTE: "1000",
        API_RATE_LIMIT_PER_MINUTE: "100000",
        OPENAI_BASE_URL: `http://localhost:${modelPort}/v1`,
        E2E_MCP_URL: `http://localhost:${mcpPort}/mcp`,
        // Operator settings (model ids) come from the instance config file —
        // bare env vars are not a config source (instance-config, #166).
        LLAME_CONFIG_PATH: path.resolve(
          __dirname,
          "e2e/support/fixtures/llame.config.e2e.json",
        ),
      }),
      url: apiUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      command: `pnpm --filter web build && pnpm --filter web exec next start --hostname localhost --port ${webPort}`,
      env: webServerEnv({
        NODE_ENV: "production",
        NEXT_PUBLIC_API_URL: apiUrl,
      }),
      url: `${webUrl}/login`,
      timeout: 120_000,
      // The build-time public API URL is part of the test boundary. Reusing an
      // arbitrary local server could silently exercise a build for a different
      // backend and would reintroduce lifecycle ambiguity.
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
