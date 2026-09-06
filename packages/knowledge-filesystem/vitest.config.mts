import { defineConfig } from "vitest/config";

const underStryker = process.env.STRYKER_MUTATOR_WORKER !== undefined;

export default defineConfig({
  test: {
    globals: true,
    testTimeout: underStryker ? 180_000 : undefined,
    hookTimeout: underStryker ? 180_000 : undefined,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary", "json"],
      reportOnFailure: true,
      // Preserve the API's pre-extraction coverage floor.
      thresholds: { lines: 90, statements: 88 },
    },
  },
});
