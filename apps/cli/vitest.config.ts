import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Workspace packages normally resolve to built ./dist; compile them from
// source here so local runs don't require a prior build.
const pkgSrc = (name: string) =>
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../packages",
    name,
    "src",
    "index.ts",
  );

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@workspace\/config$/, replacement: pkgSrc("config") },
      { find: /^@workspace\/harness$/, replacement: pkgSrc("harness") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
