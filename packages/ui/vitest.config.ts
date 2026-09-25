import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Same shape as apps/web: this package's stories are authored here but only
// apps/storybook's configuration can render them.
const storybookRoot = path.resolve(import.meta.dirname, "../../apps/storybook");
const storybookConfigDir = path.join(storybookRoot, ".storybook");

export default defineConfig({
  // The shared tsconfig sets jsx: "preserve", which esbuild does not
  // understand; see apps/web/vitest.config.ts.
  esbuild: { jsx: "automatic" },
  test: {
    // Both projects run in one invocation so their coverage lands in ONE
    // report: `unit` covers pure helpers, `stories` covers rendered
    // components in a real browser.
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text-summary", "json"],
      reportsDirectory: "./coverage",
      // Ratchet, not an allowance: raise these when coverage rises, never
      // lower one to admit a regression.
      thresholds: { lines: 81, statements: 81 },
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.*", "**/*.stories.tsx", "**/__screenshots__/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
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
          // The plugin resolves its story list against this root; see
          // apps/web/vitest.config.ts.
          root: storybookRoot,
          // apps/web's stories belong to that workspace's gate.
          exclude: ["../web/**"],
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
