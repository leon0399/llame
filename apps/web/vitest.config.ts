import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

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

const productRoots = ["app", "lib", "components", "contexts", "hooks", "utils"];

// This workspace's stories are authored here and displayed by apps/storybook,
// whose Storybook configuration is the only one that can render them.
const storybookRoot = path.resolve(import.meta.dirname, "../storybook");
const storybookConfigDir = path.join(storybookRoot, ".storybook");

// Resolves this workspace's tsconfig path aliases ("@/*", "@workspace/ui/*")
// for vitest, same as Next's own bundler already does. Additive only: every
// existing test imports relatively and is unaffected; this only unblocks
// tests that need to import a component/module via its real "@/…" path
// instead of working around the alias with a relative import.
export default defineConfig({
  plugins: [tsconfigPaths()],
  // This workspace's shared tsconfig sets jsx: "preserve" (Next/SWC does the
  // real transform) — esbuild doesn't understand "preserve" and falls back
  // to the classic transform, which needs `React` explicitly in scope.
  // Forcing the automatic runtime here means component source files under
  // test don't need an unused `import React` added just for vitest.
  esbuild: { jsx: "automatic" },
  test: {
    // Both projects run in one invocation so their coverage lands in ONE
    // report: `unit` covers logic, hooks and Query cache behavior, `stories`
    // covers rendered components in a real browser. Measuring them separately
    // would leave two partial numbers, neither of which can be held to the
    // thresholds below — and rendering moved out of jsdom precisely so the
    // browser measured it instead.
    coverage: {
      provider: "v8",
      // Write the report even when a test fails: the metric targets in
      // docs/code-quality-targets.md need a number from every run, and a
      // single unrelated failure otherwise yields none at all.
      reportOnFailure: true,
      reporter: ["text-summary", "json"],
      reportsDirectory: "./coverage",
      // Ratchet, not an allowance (both projects together measured 91.9%
      // lines / 90.0% statements): raise these when coverage rises, never
      // lower one to admit a regression. The 85% target lives in
      // docs/code-quality-targets.md.
      thresholds: { lines: 91, statements: 89 },
      // Product source only: generated clients, migrations, vendored
      // code, and the test scaffolding itself are not what the 85%
      // target is about.
      include: productRoots.map((root) => `${root}/**/*.{ts,tsx}`),
      exclude: qualityExcludes,
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: storybookConfigDir,
            storybookScript: "pnpm --filter storybook dev",
          }),
        ],
        test: {
          name: "stories",
          // The plugin serves stories from a Vite server rooted at the
          // Storybook project and resolves its story list against this same
          // root. Letting the two disagree silently drops every story that
          // lives outside apps/storybook — which is all of them.
          root: storybookRoot,
          // Storybook also displays packages/ui's stories, but those belong to
          // that package's own gate (apps/storybook runs them); this project
          // owns only the stories authored in apps/web.
          exclude: ["../../packages/ui/**"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          setupFiles: path.join(storybookConfigDir, "vitest.setup.ts"),
        },
      },
    ],
  },
});
