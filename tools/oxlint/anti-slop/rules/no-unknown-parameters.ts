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

/**
 * Local correctness patch (see UPSTREAM.md, third local divergence): names
 * covering the error family. Upstream's own `cause` exemption exists because
 * a wrapped error's cause is genuinely unknown at the wrap site;
 * `error`/`err`/`reason` are the same shape one level up -- error-
 * classification helpers and catch bindings that inspect an unknown thrown
 * value without ever wrapping it into an actual `cause`. Gated behind
 * `allowErrorFamilyNames` rather than hardcoded like `cause`, since these
 * names are a judgment call, not part of the rule's own built-in vocabulary.
 */
const ERROR_FAMILY_NAMES = new Set(["error", "err", "reason"]);

function isTypeofOfParameter(expression: ESTree.Expression, parameterName: string): boolean {
  return (
    expression.type === "UnaryExpression" &&
    expression.operator === "typeof" &&
    expression.argument.type === "Identifier" &&
    expression.argument.name === parameterName
  );
}

function isValidationCall(call: ESTree.CallExpression, parameterName: string): boolean {
  const [firstArgument] = call.arguments;
  if (
    firstArgument === undefined ||
    firstArgument.type !== "Identifier" ||
    firstArgument.name !== parameterName
  ) {
    return false;
  }
  if (call.callee.type === "Identifier") {
    return /^is[A-Z]/.test(call.callee.name);
  }
  if (
    call.callee.type === "MemberExpression" &&
    !call.callee.computed &&
    call.callee.property.type === "Identifier"
  ) {
    return call.callee.property.name === "parse" || call.callee.property.name === "safeParse";
  }
  return false;
}

/**
 * True when `expression` is a validation of `parameterName`: a type-guard
 * call (`isFoo(value)`), a `typeof`/`instanceof` narrowing check, or a
 * schema parse (`Schema.parse(value)` / `.safeParse(value)`) -- optionally
 * wrapped in a negation or parentheses (`if (!isFoo(value)) return;`).
 */
function isValidationExpression(
  expression: ESTree.Expression | null,
  parameterName: string,
): boolean {
  if (expression === null) return false;
  if (expression.type === "ParenthesizedExpression") {
    return isValidationExpression(expression.expression, parameterName);
  }
  if (expression.type === "UnaryExpression" && expression.operator === "!") {
    return isValidationExpression(expression.argument, parameterName);
  }
  if (expression.type === "CallExpression") return isValidationCall(expression, parameterName);
  if (expression.type === "BinaryExpression") {
    // `#x in obj` shares the "BinaryExpression" node type with `x in obj`
    // and ordinary binary operators, but its `left` is a `PrivateIdentifier`
    // rather than an `Expression` -- never a validation of `parameterName`.
    if (expression.left.type === "PrivateIdentifier") return false;
    if (expression.operator === "instanceof") {
      return expression.left.type === "Identifier" && expression.left.name === parameterName;
    }
    if (["===", "!==", "==", "!="].includes(expression.operator)) {
      return (
        isTypeofOfParameter(expression.left, parameterName) ||
        isTypeofOfParameter(expression.right, parameterName)
      );
    }
  }
  return false;
}

function functionBody(node: ParameterOwner): ESTree.FunctionBody | ESTree.Expression | null {
  if (node.type === "ArrowFunctionExpression") return node.body;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "TSDeclareFunction" ||
    node.type === "TSEmptyBodyFunctionExpression"
  ) {
    return node.body;
  }
  // TSCallSignatureDeclaration/TSConstructSignatureDeclaration/TSConstructorType/
  // TSFunctionType/TSMethodSignature are pure type declarations with no body.
  return null;
}

/**
 * The one expression that constitutes "the parameter's first use in the
 * body" for the `allowWhenImmediatelyValidated` exemption below, or null
 * when there is no determinable first use (no body, empty body, or a
 * first-statement shape this rule doesn't recognize) -- conservatively not
 * exempt in that case.
 */
function firstUseExpression(node: ParameterOwner): ESTree.Expression | null {
  const body = functionBody(node);
  if (body === null) return null;
  if (body.type !== "BlockStatement") return body; // arrow expression body
  const [first] = body.body;
  if (first === undefined) return null;
  if (first.type === "IfStatement") return first.test;
  if (first.type === "ReturnStatement") return first.argument;
  if (first.type === "ExpressionStatement") return first.expression;
  if (first.type === "VariableDeclaration" && first.declarations.length === 1) {
    return first.declarations[0].init;
  }
  return null;
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
    schema: [
      {
        type: "object",
        properties: {
          allowWhenImmediatelyValidated: { type: "boolean" },
          allowErrorFamilyNames: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowWhenImmediatelyValidated: false, allowErrorFamilyNames: false }],
  },
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      // `createOnce` builds this visitor once and reuses it across files, so
      // options must be read here (per node visit, i.e. per file) rather
      // than hoisted above -- reading them at `createOnce`'s top level would
      // capture a stale snapshot instead of each file's actual options.
      const option = context.options?.[0];
      const allowWhenImmediatelyValidated =
        typeof option === "object" &&
        option !== null &&
        !Array.isArray(option) &&
        option.allowWhenImmediatelyValidated === true;
      const allowErrorFamilyNames =
        typeof option === "object" &&
        option !== null &&
        !Array.isArray(option) &&
        option.allowErrorFamilyNames === true;
      const guardedName = predicateSubjectName(node);
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (name === "cause") continue;
        if (name === guardedName) continue;
        if (allowErrorFamilyNames && ERROR_FAMILY_NAMES.has(name)) continue;
        if (allowWhenImmediatelyValidated && isValidationExpression(firstUseExpression(node), name)) {
          continue;
        }
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
