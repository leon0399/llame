import { RuleTester } from "oxlint/plugins-dev";

import { noVacuousThrowAssertionRule } from "./no-vacuous-throw-assertion.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "vacuous" };

tester.run(
  "anti-slop/no-vacuous-throw-assertion",
  noVacuousThrowAssertionRule,
  {
    valid: [
      'expect(fn).toThrow("boom");',
      "expect(fn).toThrow(/boom/u);",
      "expect(fn).toThrow(TypeError);",
      'expect(fn).toThrowError("boom");',
      // Asserting nothing throws is a real claim with nothing to name.
      "expect(fn).not.toThrow();",
      "expect(fn).not.toThrowError();",
      "await expect(promise).rejects.not.toThrow();",
      'await expect(promise).rejects.toThrow("boom");',
      // Unrelated zero-argument matchers.
      "expect(fn).toHaveBeenCalled();",
    ],
    invalid: [
      { code: "expect(fn).toThrow();", errors: [error] },
      { code: "expect(fn).toThrowError();", errors: [error] },
      { code: "await expect(promise).rejects.toThrow();", errors: [error] },
      {
        code: "await expect(promise).rejects.toThrowError();",
        errors: [error],
      },
      // Negation must be in THIS chain, not merely present in the file.
      {
        code: "expect(a).not.toThrow(); expect(b).toThrow();",
        errors: [error],
      },
    ],
  },
);
