import { defineConfig } from "orval";

export default defineConfig({
  web: {
    input: {
      target: "../api/openapi.json",
      filters: {
        mode: "exclude",
        tags: ["streaming"],
      },
    },
    output: {
      target: "./lib/api/generated/index.ts",
      schemas: "./lib/api/generated/models",
      mode: "tags-split",
      client: "fetch",
      clean: true,
      override: {
        fetch: {
          forceSuccessResponse: true,
          includeHttpResponseReturnType: false,
          useRuntimeFetcher: true,
        },
      },
    },
    hooks: {
      afterAllFilesWrite: {
        command: "prettier --write",
        injectGeneratedDirsAndFiles: true,
      },
    },
  },
});
