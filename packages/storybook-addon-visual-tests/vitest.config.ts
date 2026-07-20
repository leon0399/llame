import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["test/smoke/**", "test/.tmp/**", "node_modules/**"],
  },
});
