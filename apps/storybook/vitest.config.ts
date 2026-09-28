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
      // lower one to admit a regression. Scope is `main.ts`, the only
      // `.storybook` module these node guards can execute; `preview.tsx` and
      // `vitest.setup.ts` run only inside the story projects (packages/ui,
      // apps/web) and report coverage there, so importing them here is both
      // impossible (they pull browser-only web deps) and guaranteed-0% noise.
      thresholds: { lines: 45, statements: 45 },
      include: [".storybook/**/*.{ts,tsx}"],
      exclude: [".storybook/preview.tsx", ".storybook/vitest.setup.ts"],
    },
  },
});
