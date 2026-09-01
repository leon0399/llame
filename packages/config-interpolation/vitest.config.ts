import { defineConfig } from "vitest/config";

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
      // Ratchet, not an allowance (measured 85.0% lines): raise these when coverage
      // rises, never lower one to admit a regression. The 85% target
      // lives in docs/code-quality-targets.md.
      thresholds: { lines: 84, statements: 82 },
      // Product source only: generated clients, migrations, vendored
      // code, and the test scaffolding itself are not what the 85%
      // target is about.
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.stories.tsx",
        "**/__mocks__/**",
        "**/testing/**",
        "**/db/migrations/**",
        "**/lib/api/generated/**",
        "**/vendor/**",
      ],
    },
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
