import type { ESTree } from "@oxlint/plugins";

/**
 * Any node whose params and return type belong to one function-like
 * contract: a real function, an arrow, or its interface-only spellings
 * (call/construct signatures, constructor types, function types, method
 * signatures).
 */
export type FunctionLikeNode =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

export type FunctionParameter = ESTree.ParamPattern;

/**
 * A parameter's own type annotation, unwrapping the property-modifier,
 * rest, and default-value spellings that carry it one level down.
 */
export function parameterAnnotation(
  parameter: FunctionParameter,
): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}
