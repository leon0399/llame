import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;

/** The decorated binding, past an accessibility modifier if one is present. */
function bindingOf(parameter: Parameter): ESTree.Node {
  return parameter.type === "TSParameterProperty"
    ? parameter.parameter
    : parameter;
}

/** The decorator's own name, for the message; falls back when it is not a plain call. */
function decoratorName(decorator: ESTree.Decorator): string {
  const { expression } = decorator;
  if (
    expression.type === "CallExpression" &&
    expression.callee.type === "Identifier"
  ) {
    return expression.callee.name;
  }
  if (expression.type === "Identifier") {
    return expression.name;
  }
  return "decorator";
}

/**
 * Require every parameter decorator to sit on its own line, immediately before
 * its parameter.
 *
 * Prettier preserves decorator line placement but never chooses it, so a
 * constructor drifts between the inline and split forms as different authors
 * edit it. Mixed placement makes a long dependency-injection constructor hard
 * to scan and produces reviewable-looking diffs that only move whitespace. The
 * split form is the one this repository uses.
 */
export const parameterDecoratorOwnLineRule = defineRule({
  meta: {
    type: "layout",
    docs: {
      description:
        "Require a parameter decorator to be on the line before its parameter, not inline with it.",
    },
    messages: {
      inline:
        "Place `@{{name}}(...)` on its own line, immediately before the parameter it decorates.",
    },
  },
  createOnce(context) {
    function check(parameters: ReadonlyArray<Parameter>): void {
      for (const parameter of parameters) {
        const decorators =
          parameter.type === "TSParameterProperty"
            ? parameter.decorators
            : undefined;
        const own = decorators ?? [];
        if (own.length === 0) continue;

        const binding = bindingOf(parameter);
        for (const [index, decorator] of own.entries()) {
          // Compare against whatever comes next: the following decorator
          // when one exists, otherwise the parameter's own binding. Both
          // must start on a later line than this decorator ends on.
          const next: ESTree.Node = own[index + 1] ?? binding;
          if (decorator.loc.end.line === next.loc.start.line) {
            context.report({
              node: decorator,
              messageId: "inline",
              data: { name: decoratorName(decorator) },
            });
          }
        }
      }
    }

    return {
      FunctionExpression(node) {
        check(node.params);
      },
      FunctionDeclaration(node) {
        check(node.params);
      },
      ArrowFunctionExpression(node) {
        check(node.params);
      },
    };
  },
});
