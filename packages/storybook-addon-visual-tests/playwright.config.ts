import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/smoke",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:6010",
    browserName: "chromium",
  },
  webServer: {
    command: "node --import tsx test/fixture-server.ts",
    url: "http://127.0.0.1:6010/index.json",
    reuseExistingServer: process.env.VISUAL_REUSE_SERVER === "1",
    timeout: 120_000,
  },
});
