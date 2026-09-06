import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Stryker relocates this package without its sibling source tree. Its task
    // builds runtime-safety first, so use the workspace export in that sandbox.
    alias:
      process.env.STRYKER_MUTATOR_WORKER !== undefined
        ? []
        : [
            {
              find: "@workspace/runtime-safety",
              replacement: path.resolve(
                import.meta.dirname,
                "../runtime-safety/src/index.ts",
              ),
            },
          ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/mcp-test-fixture.ts"],
      reporter: ["text-summary", "json"],
      reportOnFailure: true,
      // Preserve the API's pre-extraction coverage floor.
      thresholds: { lines: 90, statements: 88 },
    },
  },
});
