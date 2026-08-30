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
    ],
  },
);
