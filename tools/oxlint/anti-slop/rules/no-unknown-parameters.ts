import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
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

function parameterName(parameter: Parameter, sourceText: string): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceText);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceText);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceText);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

/**
 * Local correctness patch (see UPSTREAM.md): a type predicate's subject
 * parameter (`function isFoo(value: unknown): value is Foo`) MUST be typed
 * `unknown` for the guard to be sound — TypeScript rejects a narrower
 * parameter type there. That is the canonical legitimate use this rule
 * exists to funnel code toward, not an instance of the slop it targets.
 * Returns the name of the one parameter a predicate return type exempts, or
 * null if the owner has no predicate return type.
 */
function predicateSubjectName(node: ParameterOwner): string | null {
  const predicate = node.returnType?.typeAnnotation;
  if (predicate === null || predicate === undefined || predicate.type !== "TSTypePredicate") {
    return null;
  }
  return predicate.parameterName.type === "Identifier" ? predicate.parameterName.name : null;
}

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause` or a type predicate's subject; decode unknown input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
    },
  },
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      const guardedName = predicateSubjectName(node);
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (name === "cause") continue;
        if (name === guardedName) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
