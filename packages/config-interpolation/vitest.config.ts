import { defineConfig } from "vitest/config";

const qualityExcludes = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.tsx",
  "**/__mocks__/**",
  "**/testing/**",
  "**/db/migrations/**",
  "**/lib/api/generated/**",
  "**/vendor/**",
];

export default defineConfig({
  // Globals: the extracted test files were written against the API's
  // globals-enabled Vitest setup and move verbatim.
  test: {
    coverage: {
      provider: "v8",
      // Write the report even when a test fails: the metric targets in
      // docs/code-quality-targets.md need a number from every run, and a
      // single unrelated failure otherwise yields none at all.
      reportOnFailure: true,
      reporter: ["text-summary", "json"],
      reportsDirectory: "./coverage",
      // Current ratchet: 96% lines and 93% statements. Raise it with coverage;
      // never lower it to admit a regression.
      thresholds: { lines: 96, statements: 93 },
      // Product source only: generated clients, migrations, vendored
      // code, and the test scaffolding itself are not what the 85%
      // gate is about.
      include: ["src/**/*.ts"],
      exclude: qualityExcludes,
    },
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
