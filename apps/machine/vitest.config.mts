import path from "node:path";
import { defineConfig } from "vitest/config";

// The daemon's workspace dependencies normally resolve to built `./dist`; the
// suite compiles them from source here so it can run without a build.
const pkgSrc = (name: string) =>
  path.resolve(import.meta.dirname, "../../packages", name, "src", "index.ts");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@workspace\/machine-protocol$/,
        replacement: pkgSrc("machine-protocol"),
      },
      {
        find: /^@workspace\/native-file-tools$/,
        replacement: pkgSrc("native-file-tools"),
      },
      {
        find: /^@workspace\/bash-executor$/,
        replacement: pkgSrc("bash-executor"),
      },
      {
        find: /^@workspace\/mcp-workspace$/,
        replacement: pkgSrc("mcp-workspace"),
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
      // `cli.ts` is the argv shell the bundle starts; every branch worth
      // measuring lives in `cli-commands.ts`.
      exclude: ["src/**/*.test.ts", "src/cli.ts"],
      reporter: ["text-summary", "json"],
      reportOnFailure: true,
      thresholds: { lines: 90, statements: 88 },
    },
  },
});
