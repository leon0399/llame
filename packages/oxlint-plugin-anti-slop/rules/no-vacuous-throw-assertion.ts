import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const THROW_MATCHERS = new Set(["toThrow", "toThrowError"]);

/** Does `.not` appear anywhere in the matcher chain leading to this call? */
function isNegated(node: ESTree.Expression): boolean {
  let current: ESTree.Expression = node;
  while (current.type === "MemberExpression") {
    if (
      !current.computed &&
      current.property.type === "Identifier" &&
      current.property.name === "not"
    ) {
      return true;
    }
    current = current.object;
  }
  return false;
}

/**
 * Require a throw assertion to name the error it expects.
 *
 * `expect(fn).toThrow()` is satisfied by *any* thrown value, so it keeps
 * passing after the code starts failing for an entirely unrelated reason — a
 * typo in the test's own setup, a renamed import, a null dereference three
 * frames down. It reports that an error path is covered while proving only that
 * something, somewhere, threw. That is `docs/testing.md` rule 11's shape: a test
 * that cannot fail for the reason it claims to check.
 *
 * Pass the expected message, a substring, a regular expression, or the error
 * class. `.not.toThrow()` stays valid: asserting that nothing throws is a real
 * claim with nothing to name.
 */
export const noVacuousThrowAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require toThrow/toThrowError to name the expected error; a bare throw assertion is satisfied by every error.",
    },
    messages: {
      vacuous:
        "`{{matcher}}()` accepts any thrown value, so it survives the code failing for an unrelated reason. Name the expected error: a message, a substring, a RegExp, or the error class.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.arguments.length > 0) return;
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        if (!THROW_MATCHERS.has(callee.property.name)) return;
        if (isNegated(callee.object)) return;

        context.report({
          node,
          messageId: "vacuous",
          data: { matcher: callee.property.name },
        });
      },
    };
  },
});
