import { nextJsConfig } from "@workspace/config-eslint/next-js"

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  // `next lint` is gone in Next 16 — plain `eslint .` runs here, so build
  // output must be ignored explicitly.
  { ignores: [".next/**", "next-env.d.ts"] },
  // Node-executed config files (plain JS, so js/recommended's no-undef fires
  // on `process` without this global).
  {
    files: ["*.mjs", "*.config.*"],
    languageOptions: { globals: { process: "readonly" } },
  },
]
