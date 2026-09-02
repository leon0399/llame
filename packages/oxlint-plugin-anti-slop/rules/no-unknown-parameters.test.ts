import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = (parameter: string) => ({
  messageId: "unknownParameter",
  data: { parameter },
});

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
    // `allowWhenImmediatelyValidated`: the parameter's first use in the body
    // validates that same parameter.
    {
      code: "function accept(value: unknown): void { if (isRecord(value)) { use(value); } }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    {
      code: "function accept(value: unknown): void { if (!isRecord(value)) return; use(value); }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    {
      code: "function accept(value: unknown): void { const parsed = Schema.parse(value); use(parsed); }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    {
      code: "function accept(value: unknown): void { const result = Schema.safeParse(value); use(result); }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    {
      code: "const accept = (value: unknown) => Schema.parse(value);",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    {
      code: "function accept(value: unknown): boolean { return typeof value === 'string'; }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    {
      code: "function accept(value: unknown): boolean { return value instanceof Error; }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    // (a) `Array.isArray(x)` is a standard-library type guard, same class as
    // `typeof`/`instanceof`.
    {
      code: "function accept(value: unknown): void { if (Array.isArray(value)) { use(value); } }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    // (b) `switch (typeof x)` is the switch-statement spelling of
    // `typeof x === ...`.
    {
      code: "function accept(value: unknown): void { switch (typeof value) { case 'string': use(value); break; default: break; } }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    // (b) `switch (true)` whose first case tests the parameter -- the
    // trivial, unambiguous shape only.
    {
      code: "function accept(value: unknown): void { switch (true) { case isRecord(value): use(value); break; default: break; } }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    // (c) An overload signature (no body of its own) inherits the adjacent
    // implementation signature's verdict.
    {
      code: "function accept(value: unknown): void; function accept(value: unknown): void { if (isRecord(value)) { use(value); } }",
      options: [{ allowWhenImmediatelyValidated: true }],
    },
    // `allowErrorFamilyNames`: names beyond `cause` in the same family.
    {
      code: "function classify(error: unknown): string { return String(error); }",
      options: [{ allowErrorFamilyNames: true }],
    },
    {
      code: "function classify(err: unknown): string { return String(err); }",
      options: [{ allowErrorFamilyNames: true }],
    },
    {
      code: "function classify(reason: unknown): string { return String(reason); }",
      options: [{ allowErrorFamilyNames: true }],
    },
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
    {
      // `allowWhenImmediatelyValidated` off by default: an otherwise-valid
      // structural exemption shape is still flagged without the option.
      code: "function accept(value: unknown): void { if (isRecord(value)) { use(value); } }",
      errors: [error("value")],
    },
    {
      // With the option on, an unvalidated `unknown` parameter is still
      // flagged -- the exemption never applies without a genuine first-use
      // validation.
      code: "function accept(value: unknown): void { use(value); }",
      options: [{ allowWhenImmediatelyValidated: true }],
      errors: [error("value")],
    },
    {
      // The validation must be of the *same* parameter, not just any check
      // in the first statement.
      code: "function accept(value: unknown, other: string): void { if (isRecord(other)) { use(value); } }",
      options: [{ allowWhenImmediatelyValidated: true }],
      errors: [error("value")],
    },
    {
      // A validation that isn't the *first* use doesn't count.
      code: "function accept(value: unknown): void { use(value); if (isRecord(value)) { use(value); } }",
      options: [{ allowWhenImmediatelyValidated: true }],
      errors: [error("value")],
    },
    {
      // `allowErrorFamilyNames` off by default: `error` is still flagged
      // without the option.
      code: "function classify(error: unknown): string { return String(error); }",
      errors: [error("error")],
    },
    {
      // `allowErrorFamilyNames` is a narrow, named allowlist -- it must not
      // rubber-stamp generic parameter names.
      code: "function accept(value: unknown): void {}",
      options: [{ allowErrorFamilyNames: true }],
      errors: [error("value")],
    },
    {
      // (a) A non-first `Array.isArray` doesn't count -- same "first use
      // only" rule as every other validation shape.
      code: "function accept(value: unknown): void { use(value); if (Array.isArray(value)) { use(value); } }",
      options: [{ allowWhenImmediatelyValidated: true }],
      errors: [error("value")],
    },
    {
      // (b) `switch (true)` is only recognized when the *first* case tests
      // the parameter -- a `default` (or any other) case first makes the
      // shape ambiguous, so it is skipped, not exempted.
      code: "function accept(value: unknown): void { switch (true) { default: break; case isRecord(value): use(value); break; } }",
      options: [{ allowWhenImmediatelyValidated: true }],
      errors: [error("value")],
    },
    {
      // (c) An overload whose implementation does NOT validate the
      // parameter is still flagged -- at both the overload signature and
      // the implementation, since neither has a genuine first-use
      // validation.
      code: "function accept(value: unknown): void; function accept(value: unknown): void { use(value); }",
      options: [{ allowWhenImmediatelyValidated: true }],
      errors: [error("value"), error("value")],
    },
  ],
});
