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
    coverage: {
      provider: "v8",
      // Write the report even when a test fails: the metric targets in
      // docs/code-quality-targets.md need a number from every run, and a
      // single unrelated failure otherwise yields none at all.
      reportOnFailure: true,
      reporter: ["text-summary", "json"],
      reportsDirectory: "./coverage",
      // Ratchet, not an allowance (web measured 88.6% lines): raise these when coverage
      // rises, never lower one to admit a regression. The 85% target
      // lives in docs/code-quality-targets.md.
      thresholds: { lines: 88, statements: 86 },
      // Product source only: generated clients, migrations, vendored
      // code, and the test scaffolding itself are not what the 85%
      // target is about.
      include: productRoots.map((root) => `${root}/**/*.{ts,tsx}`),
      exclude: qualityExcludes,
    },
  },
});
