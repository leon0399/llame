import { defineConfig } from "@playwright/test";

const devPort = process.env.VISUAL_TEST_DEV_PORT ?? "6010";

export default defineConfig({
  testDir: "./test/smoke",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${devPort}`,
    browserName: "chromium",
  },
  webServer: {
    command: "exec node --import tsx test/fixture-server.ts",
    url: `http://127.0.0.1:${devPort}/index.json`,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    timeout: 300_000,
  },
});
