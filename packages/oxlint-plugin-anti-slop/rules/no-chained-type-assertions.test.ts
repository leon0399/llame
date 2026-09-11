import { RuleTester } from "oxlint/plugins-dev";

import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "chained" };

tester.run(
  "anti-slop/no-chained-type-assertions",
  noChainedTypeAssertionsRule,
  {
    valid: [
      "declare const value: string; const narrowed = value! as { readonly safe: true };",
      "declare const value: string; const narrowed = (value as { readonly safe: true })!;",
      // Upstream cases: a single assertion, parenthesized or not, is not a
      // chain, and a chain made only of `as const` is still valid.
      "interface User { readonly id: string } declare const input: unknown; const parsed = input as User;",
      "interface User { readonly id: string } declare const input: unknown; const parsed = (input as User);",
      "const config = ({ id: 1 } as const) as const;",
    ],
    invalid: [
      {
        code: "declare const value: string; const bypass = (value as unknown)! as { readonly safe: true };",
        errors: [error],
      },
      {
        code: "declare const value: string; const bypass = (<unknown>value)! as { readonly safe: true };",
        errors: [error],
      },
      {
        code: "declare const value: string; const bypass = ((value as unknown as { readonly safe: true })!) as { readonly final: true };",
        errors: [error],
      },
      // Upstream cases.
      {
        code: "interface User { readonly id: string } declare const input: unknown; const parsed = input as unknown as User;",
        errors: [error],
      },
      {
        code: "interface User { readonly id: string } declare const input: unknown; const parsed = (input as unknown) as User;",
        errors: [error],
      },
      {
        code: "interface User { readonly id: string } const parsed = <User>(<unknown>input);",
        errors: [error],
      },
      {
        code: "interface User { readonly id: string } const invalidMixedConst = ({ id: 1 } as const) as User;",
        errors: [error],
      },
    ],
  },
);
