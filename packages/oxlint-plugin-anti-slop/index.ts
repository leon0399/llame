import { eslintCompatPlugin } from "@oxlint/plugins";

import { forbidProcessEnvOutsideEnvTsRule } from "./vendor/forbid-process-env-outside-env-ts.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUntrackedTodoRule } from "./rules/no-untracked-todo.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noUnsafeInnerHtmlRule } from "./vendor/no-unsafe-inner-html.ts";
import { noVacuousThrowAssertionRule } from "./rules/no-vacuous-throw-assertion.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { parameterDecoratorOwnLineRule } from "./rules/parameter-decorator-own-line.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";
import { requireTimestamptzColumnRule } from "./vendor/require-timestamptz-column.ts";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "forbid-process-env-outside-env-ts": forbidProcessEnvOutsideEnvTsRule,
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-module-mocking": noModuleMockingRule,
    "no-object-parameters": noObjectParametersRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
    "no-unsafe-inner-html": noUnsafeInnerHtmlRule,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
    "no-untracked-todo": noUntrackedTodoRule,
    "no-unknown-parameters": noUnknownParametersRule,
    "no-unknown-returns": noUnknownReturnsRule,
    "no-unknown-type-aliases": noUnknownTypeAliasesRule,
    "no-vacuous-throw-assertion": noVacuousThrowAssertionRule,
    "no-widen-then-assert": noWidenThenAssertRule,
    "parameter-decorator-own-line": parameterDecoratorOwnLineRule,
    "require-safety-comment-for-type-assertion":
      requireSafetyCommentForTypeAssertionRule,
    "require-timestamptz-column": requireTimestamptzColumnRule,
  },
});

export default antiSlopPlugin;
