import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/**
 * Resolve `identifier` to its declaring variable by walking the scope chain
 * outward from its own scope, or null when nothing in the program declares
 * it (a true global).
 */
export function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}
