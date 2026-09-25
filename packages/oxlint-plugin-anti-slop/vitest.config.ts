import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // oxlint's RuleTester registers each case through the global describe/it
    // when they exist, so every valid/invalid case becomes its own Vitest test.
    globals: true,
    environment: "node",
    include: ["rules/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text-summary", "json"],
      reportsDirectory: "./coverage",
      // Ratchet, not an allowance: raise these when coverage rises, never
      // lower one to admit a regression.
      thresholds: { lines: 80, statements: 77 },
      // vendor/ is upstream code kept as received, excluded as in every
      // other workspace's gate.
      include: ["index.ts", "rules/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
