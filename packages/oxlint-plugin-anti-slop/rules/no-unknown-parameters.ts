import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  parameterAnnotation,
  type FunctionLikeNode,
  type FunctionParameter,
} from "../shared/function-like.ts";

function parameterName(
  parameter: FunctionParameter,
  sourceText: string,
): string {
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
function predicateSubjectName(node: FunctionLikeNode): string | null {
  const predicate = node.returnType?.typeAnnotation;
  if (
    predicate === null ||
    predicate === undefined ||
    predicate.type !== "TSTypePredicate"
  ) {
    return null;
  }
  return predicate.parameterName.type === "Identifier"
    ? predicate.parameterName.name
    : null;
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

function isTypeofOfParameter(
  expression: ESTree.Expression,
  parameterName: string,
): boolean {
  return (
    expression.type === "UnaryExpression" &&
    expression.operator === "typeof" &&
    expression.argument.type === "Identifier" &&
    expression.argument.name === parameterName
  );
}

function isValidationCall(
  call: ESTree.CallExpression,
  parameterName: string,
): boolean {
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
    const propertyName = call.callee.property.name;
    if (propertyName === "parse" || propertyName === "safeParse") return true;
    // `Array.isArray(x)` is TypeScript's own standard-library type guard
    // (`lib.es5.d.ts` declares it `arg is any[]`) -- the same class as
    // `typeof`/`instanceof`, not a codebase-specific pattern.
    return (
      propertyName === "isArray" &&
      call.callee.object.type === "Identifier" &&
      call.callee.object.name === "Array"
    );
  }
  return false;
}

/**
 * True when `node`'s `discriminant` makes it a validation of `parameterName`:
 * `switch (typeof x) { ... }` (the switch-statement spelling of `typeof x ===
 * ...`), or `switch (true) { case <test>: ... }` whose first case's test
 * validates `parameterName` -- only that trivial, unambiguous shape; any
 * other `switch (true)` case ordering or a `default`-first clause is skipped,
 * not exempted.
 */
function switchStatementFirstUse(
  node: ESTree.SwitchStatement,
): ESTree.Expression | null {
  if (
    node.discriminant.type === "UnaryExpression" &&
    node.discriminant.operator === "typeof"
  ) {
    return node.discriminant;
  }
  if (
    node.discriminant.type === "Literal" &&
    typeof node.discriminant.value === "boolean" &&
    node.discriminant.value === true
  ) {
    const [firstCase] = node.cases;
    if (firstCase !== undefined && firstCase.test !== null)
      return firstCase.test;
  }
  return null;
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
  // Bare `typeof x`, as it appears as a `switch (typeof x)` discriminant --
  // the switch-statement spelling of the `typeof x === ...` comparison
  // already handled below.
  if (isTypeofOfParameter(expression, parameterName)) return true;
  if (expression.type === "CallExpression")
    return isValidationCall(expression, parameterName);
  if (expression.type === "BinaryExpression") {
    // `#x in obj` shares the "BinaryExpression" node type with `x in obj`
    // and ordinary binary operators, but its `left` is a `PrivateIdentifier`
    // rather than an `Expression` -- never a validation of `parameterName`.
    if (expression.left.type === "PrivateIdentifier") return false;
    if (expression.operator === "instanceof") {
      return (
        expression.left.type === "Identifier" &&
        expression.left.name === parameterName
      );
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

function functionBody(
  node: FunctionLikeNode,
): ESTree.FunctionBody | ESTree.Expression | null {
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
function firstUseExpression(node: FunctionLikeNode): ESTree.Expression | null {
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
  if (first.type === "SwitchStatement") return switchStatementFirstUse(first);
  return null;
}

function unwrapExportedDeclaration(
  statement: ESTree.Statement,
): ESTree.Statement | ESTree.Declaration {
  if (
    statement.type === "ExportNamedDeclaration" &&
    statement.declaration !== null
  ) {
    return statement.declaration;
  }
  if (
    statement.type === "ExportDefaultDeclaration" &&
    (statement.declaration.type === "FunctionDeclaration" ||
      statement.declaration.type === "TSDeclareFunction")
  ) {
    return statement.declaration;
  }
  return statement;
}

/**
 * For a body-less overload signature (`TSDeclareFunction` -- the node type
 * every headless `function foo(...): T;` signature parses as, overload or
 * ambient), find the adjacent implementation signature: the sibling
 * declaration in the same scope with the same function name and an actual
 * body. An overload signature having no body is a mechanical artifact of the
 * declaration form, not a statement that its parameter is unvalidated, so its
 * exemption is inherited from whichever signature actually implements it. If
 * no matching sibling with a body exists (e.g. a genuinely ambient
 * declaration), this returns null and the caller stays unexempted.
 */
function resolveOverloadImplementation(
  node: FunctionLikeNode,
): ESTree.Function | null {
  if (node.type !== "TSDeclareFunction" || node.id === null) return null;
  let container: ESTree.Node = node.parent;
  if (
    container.type === "ExportNamedDeclaration" ||
    container.type === "ExportDefaultDeclaration"
  ) {
    container = container.parent;
  }
  if (
    container.type !== "Program" &&
    container.type !== "BlockStatement" &&
    container.type !== "TSModuleBlock"
  ) {
    return null;
  }
  for (const statement of container.body) {
    const declaration = unwrapExportedDeclaration(statement);
    if (
      (declaration.type === "FunctionDeclaration" ||
        declaration.type === "TSDeclareFunction") &&
      declaration.id !== null &&
      declaration.id.name === node.id.name &&
      declaration.body !== null
    ) {
      return declaration;
    }
  }
  return null;
}

/**
 * Whether `parameterName` on `node` is exempted by `allowWhenImmediatelyValidated`:
 * either `node` itself validates it as its first body use, or (for a
 * body-less overload signature) the adjacent implementation signature does.
 */
function isImmediatelyValidated(
  node: FunctionLikeNode,
  parameterName: string,
): boolean {
  if (isValidationExpression(firstUseExpression(node), parameterName))
    return true;
  const implementation = resolveOverloadImplementation(node);
  if (implementation === null) return false;
  return isValidationExpression(
    firstUseExpression(implementation),
    parameterName,
  );
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
    defaultOptions: [
      { allowWhenImmediatelyValidated: false, allowErrorFamilyNames: false },
    ],
  },
  createOnce(context) {
    const checkParameters = (node: FunctionLikeNode) => {
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
        const name = parameterName(
          parameter,
          context.sourceCode.getText(parameter),
        );
        if (name === "cause") continue;
        if (name === guardedName) continue;
        if (allowErrorFamilyNames && ERROR_FAMILY_NAMES.has(name)) continue;
        if (allowWhenImmediatelyValidated && isImmediatelyValidated(node, name))
          continue;
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
