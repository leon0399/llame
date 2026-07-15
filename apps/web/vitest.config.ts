import path from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const dirname = path.dirname(fileURLToPath(import.meta.url));

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
    projects: [
      {
        extends: true,
        test: { name: "unit" },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
            storybookScript: "pnpm --filter web storybook --no-open",
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          setupFiles: ".storybook/vitest.setup.ts",
        },
      },
    ],
  },
});
