import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveVariable } from "../shared/resolve-variable.ts";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier"
    ? node.imported.name
    : node.imported.value;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  if (
    (expression.name === "vi" || expression.name === "jest") &&
    sourceCode.isGlobalReference(expression)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return variable.defs.some((definition) => {
    if (
      definition.type !== "ImportBinding" ||
      definition.parent?.type !== "ImportDeclaration"
    ) {
      return false;
    }
    const source = definition.parent.source.value;
    const name = importedName(definition.node);
    return (
      (source === "vitest" && name === "vi") ||
      (source === "@jest/globals" && name === "jest")
    );
  });
}

function moduleMockCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
): boolean {
  if (
    !("property" in callee) ||
    !("object" in callee) ||
    !("computed" in callee)
  )
    return false;
  if (!isTestFrameworkObject(sourceCode, callee.object)) return false;
  const property = callee.property;
  const method = callee.computed
    ? property.type === "Literal" &&
      (property.value === "doMock" ||
        property.value === "mock" ||
        property.value === "unstable_mockModule")
      ? property.value
      : null
    : property.type === "Identifier"
      ? property.name
      : null;
  return method !== null && moduleMockMethods.has(method);
}

/**
 * Is this specifier a module this repository owns?
 *
 * Relative paths, the `@/` app alias and `@workspace/*` are ours: mocking one
 * replaces our own code with a fixture, which is what this rule exists to
 * stop. A bare npm specifier — `next/navigation`, `@ai-sdk/react` — is an
 * external boundary, and replacing it in a test is the same category of act as
 * stubbing `fetch`. The rule's own message asks for "a real interface"; a
 * third-party package IS the interface, and there is frequently no in-process
 * seam behind it (a Server Component's `redirect()` is not injectable).
 *
 * A non-literal specifier is treated as owned: it cannot be checked, and
 * failing closed is the safer default for a rule about hiding real code.
 */
function isWorkspaceSpecifier(node: ESTree.Node | undefined): boolean {
  if (node === undefined) return true;
  if (node.type !== "Literal" || typeof node.value !== "string") return true;
  const specifier = node.value;
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("@workspace/") ||
    specifier.startsWith("~/")
  );
}

/** Ban test framework module mocking of first-party modules. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking of first-party modules; tests must replace them through real interfaces. External npm packages stay allowed.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Super" ||
          node.callee.type === "V8IntrinsicExpression"
        )
          return;
        if (!moduleMockCall(context.sourceCode, node.callee)) return;
        if (!isWorkspaceSpecifier(node.arguments[0])) return;
        context.report({ node, messageId: "moduleMock" });
      },
    };
  },
});
