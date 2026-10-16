import { RuleTester } from "oxlint/plugins-dev";

import { noStackedJsdocRule } from "./no-stacked-jsdoc.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "stacked" };

tester.run("anti-slop/no-stacked-jsdoc", noStackedJsdocRule, {
  valid: [
    "/** Adds one. */\nfunction inc(n: number) { return n + 1; }",
    // A module overview may sit directly above the first declaration's doc.
    "/**\n * Module overview.\n */\n/** Adds one. */\nexport function inc(n: number) { return n + 1; }",
    "#!/usr/bin/env node\n/** Overview. */\n/** Adds one. */\nfunction inc(n: number) { return n + 1; }",
    // Separated by code: each block documents its own declaration.
    "import x from 'x';\n/** A. */\nconst a = x;\n/** B. */\nconst b = a;",
    // Plain block and line comments are not JSDoc.
    "const a = 1;\n/* note */\n/** Adds one. */\nfunction inc(n: number) { return n + a; }",
    "const a = 1;\n/** Adds one. */\n// eslint-disable-next-line no-console\nfunction inc(n: number) { return n + a; }",
    "const a = 1;\n/** A. */ /* trailing */\nconst b = a;",
  ],
  invalid: [
    {
      code: "const a = 1;\n/** Stranded doc for something else. */\n/** Adds one. */\nfunction inc(n: number) { return n + a; }",
      errors: [error],
    },
    {
      code: "import x from 'x';\n/**\n * Old doc.\n */\n\n/**\n * New doc.\n */\nexport const y = x;",
      errors: [error],
    },
    {
      code: "class A {\n  /** Stale. */\n  /** Current. */\n  m() {}\n}",
      errors: [error],
    },
    // Three in a row: the first two are stranded.
    {
      code: "const a = 1;\n/** One. */\n/** Two. */\n/** Three. */\nconst b = a;",
      errors: [error, error],
    },
  ],
});
