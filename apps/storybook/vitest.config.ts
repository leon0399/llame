import { defineConfig } from "vitest/config";

// Stories run from the workspace that authors them (packages/ui, apps/web),
// through this package's .storybook configuration. What is left here are
// node-only guards over that configuration.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text-summary", "json"],
      reportsDirectory: "./coverage",
      // Ratchet, not an allowance: raise these when coverage rises, never
      // lower one to admit a regression. preview.tsx and vitest.setup.ts run
      // only inside the story projects, which report to their own workspace.
      thresholds: { lines: 26, statements: 25 },
      include: [".storybook/**/*.{ts,tsx}"],
    },
  },
});
