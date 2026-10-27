import path from "node:path";

import {
  ScriptKind,
  SyntaxKind,
  type Node,
  type SourceFile,
} from "typescript/ast";
import {
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
} from "typescript/ast/is";
import { API } from "typescript/sync";
import { afterAll, describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

// One compiler session for the file: it owns a native worker, and every
// source file it parses stays retained until the session closes.
const api = new API();
afterAll(() => api.close());

function parse(relativePath: string): SourceFile {
  return api.createSourceFileFromFile(path.join(repoRoot, relativePath), {
    scriptKind: ScriptKind.TSX,
  }).sourceFile;
}

function staticImports(source: SourceFile): Array<string> {
  return source.statements.flatMap((statement) => {
    if (
      !isImportDeclaration(statement) ||
      !isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier === SyntaxKind.TypeKeyword
    ) {
      return [];
    }
    return [statement.moduleSpecifier.text];
  });
}

function dynamicImports(source: Node): Array<string> {
  const imports: Array<string> = [];

  function visit(node: Node): void {
    if (
      isCallExpression(node) &&
      node.expression.kind === SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    node.forEachChild(visit);
  }

  visit(source);
  return imports;
}

function clientOnlyDynamicImports(source: SourceFile): Array<string> {
  const imports: Array<string> = [];

  function visit(node: Node): void {
    if (
      isCallExpression(node) &&
      isIdentifier(node.expression) &&
      node.expression.text === "dynamic" &&
      node.arguments.length === 2 &&
      isObjectLiteralExpression(node.arguments[1]) &&
      node.arguments[1].properties.some(
        (property) =>
          isPropertyAssignment(property) &&
          property.name.getText(source) === "ssr" &&
          property.initializer.kind === SyntaxKind.FalseKeyword,
      )
    ) {
      imports.push(...dynamicImports(node.arguments[0]));
    }
    node.forEachChild(visit);
  }

  visit(source);
  return imports;
}

describe("chat bundle boundary", () => {
  test.each([
    "packages/ui/src/components/ai-elements/message.tsx",
    "packages/ui/src/components/ai-elements/reasoning.tsx",
  ])("keeps the Streamdown plugin graph out of %s", (relativePath) => {
    const heavyImports = staticImports(parse(relativePath)).filter(
      (specifier) =>
        /streamdown|regex-tester|model-output-streamdown|message-response|reasoning-content|internal\/regex-tester/.test(
          specifier,
        ),
    );

    expect(heavyImports).toEqual([]);
  });

  test("loads markdown renderers from ChatMarkdownProvider, not the message row", () => {
    const row = parse("apps/web/app/(chat)/components/chat-message-row.tsx");
    const ready = parse(
      "apps/web/app/(chat)/components/use-chat-markdown-ready.tsx",
    );
    const renderers = [
      "@workspace/ui/components/ai-elements/message-response",
      "@workspace/ui/components/ai-elements/reasoning-content",
    ];

    expect(staticImports(row)).not.toEqual(expect.arrayContaining(renderers));
    expect(dynamicImports(row)).not.toEqual(expect.arrayContaining(renderers));
    expect(clientOnlyDynamicImports(row)).toEqual([]);

    expect(staticImports(ready)).not.toEqual(expect.arrayContaining(renderers));
    expect(dynamicImports(ready)).toEqual(expect.arrayContaining(renderers));
  });
});
