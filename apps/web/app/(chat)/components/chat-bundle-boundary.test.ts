import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

function parse(relativePath: string): ts.SourceFile {
  const absolutePath = path.join(repoRoot, relativePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function staticImports(source: ts.SourceFile): Array<string> {
  return source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly
    ) {
      return [];
    }
    return [statement.moduleSpecifier.text];
  });
}

function dynamicImports(source: ts.SourceFile): Array<string> {
  const imports: Array<string> = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return imports;
}

function clientOnlyDynamicImports(source: ts.SourceFile): Array<string> {
  const imports: Array<string> = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "dynamic" &&
      node.arguments.length === 2 &&
      ts.isObjectLiteralExpression(node.arguments[1]) &&
      node.arguments[1].properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === "ssr" &&
          property.initializer.kind === ts.SyntaxKind.FalseKeyword,
      )
    ) {
      const loaderImports = dynamicImports(
        ts.createSourceFile(
          "loader.tsx",
          node.arguments[0].getText(source),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        ),
      );
      imports.push(...loaderImports);
    }
    ts.forEachChild(node, visit);
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
