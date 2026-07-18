import path from "node:path";
import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The shared tsconfig sets jsx: "preserve" (the framework bundler does the
  // real transform) — esbuild doesn't understand "preserve" and falls back to
  // the classic transform, which needs `React` explicitly in scope. Forcing
  // the automatic runtime keeps story/preview files free of unused imports.
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        extends: true,
        test: {
          // Plain node tests (e.g. the globals.css ordering guard) — safe for
          // `turbo run test`, which runs without Playwright browsers.
          name: "unit",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
            storybookScript: "pnpm --filter storybook dev",
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
