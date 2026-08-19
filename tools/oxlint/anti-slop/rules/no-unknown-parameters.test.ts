import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = (parameter: string) => ({ messageId: "unknownParameter", data: { parameter } });

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    // The rule's own explicit exemption.
    "function wrap(message: string, cause: unknown): Error { return new Error(message, { cause }); }",
    // A type predicate's subject parameter must stay `unknown` for the guard
    // to be sound -- the local correctness patch's exemption.
    "function isFoo(value: unknown): value is string { return typeof value === 'string'; }",
    "const isBar = (value: unknown): value is number => typeof value === 'number';",
    "interface Guards { isBaz(value: unknown): value is boolean; }",
    "type Guard = (value: unknown) => value is boolean;",
  ],
  invalid: [
    {
      code: "function accept(value: unknown): void {}",
      errors: [error("value")],
    },
    {
      code: "function wrap(message: string, cause: unknown, extra: unknown): Error { return new Error(message, { cause }); }",
      // `cause` is exempt; `extra` is not, even in the same signature.
      errors: [error("extra")],
    },
    {
      // The predicate exempts only the parameter it names, not every
      // `unknown` parameter in the same signature.
      code: "function isFoo(value: unknown, other: unknown): value is string { return typeof value === 'string'; }",
      errors: [error("other")],
    },
    {
      // A type predicate on parameter `a` does not exempt `unknown` on a
      // different parameter `b`.
      code: "function isFoo(a: string, b: unknown): a is string { return true; }",
      errors: [error("b")],
    },
  ],
});
