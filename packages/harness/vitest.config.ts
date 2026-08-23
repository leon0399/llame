import { defineConfig } from "vitest/config";

export default defineConfig({
  // Globals: the extracted test files were written against the API's
  // globals-enabled Vitest setup and move verbatim.
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
