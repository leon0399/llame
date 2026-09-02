import { RuleTester } from "oxlint/plugins-dev";

import { parameterDecoratorOwnLineRule } from "./parameter-decorator-own-line.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "inline" };

tester.run(
  "anti-slop/parameter-decorator-own-line",
  parameterDecoratorOwnLineRule,
  {
    valid: [
      // The split form this repository uses.
      `class A {
  constructor(
    @Inject(Token)
    private readonly dep: Dep,
  ) {}
}`,
      // Several decorators, each on its own line.
      `class A {
  constructor(
    @Inject(Token)
    @Optional()
    private readonly dep: Dep,
  ) {}
}`,
      // No decorator at all.
      `class A {
  constructor(private readonly dep: Dep) {}
}`,
      // Plain parameter without an accessibility modifier.
      `class A {
  constructor(
    @Inject(Token)
    dep: Dep,
  ) {}
}`,
    ],
    invalid: [
      {
        code: `class A {
  constructor(
    @Inject(Token) private readonly dep: Dep,
  ) {}
}`,
        errors: [error],
      },
      {
        // Second decorator inline with the parameter; the first is fine.
        code: `class A {
  constructor(
    @Inject(Token)
    @Optional() private readonly dep: Dep,
  ) {}
}`,
        errors: [error],
      },
      {
        // Both decorators inline: two separate reports.
        code: `class A {
  constructor(
    @Inject(Token) @Optional() private readonly dep: Dep,
  ) {}
}`,
        errors: [error, error],
      },
      {
        // Whole constructor on one line.
        code: `class A {
  constructor(@Inject(Token) private readonly dep: Dep) {}
}`,
        errors: [error],
      },
    ],
  },
);
