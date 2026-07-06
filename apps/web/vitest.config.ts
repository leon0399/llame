import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

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
});
