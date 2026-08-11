import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

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

function staticImports(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

function dynamicImports(source: ts.SourceFile): string[] {
  const imports: string[] = [];

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

describe("chat bundle boundary", () => {
  test.each([
    "packages/ui/src/components/ai-elements/message.tsx",
    "packages/ui/src/components/ai-elements/reasoning.tsx",
  ])("keeps the Streamdown plugin graph out of %s", (relativePath) => {
    const heavyImports = staticImports(parse(relativePath)).filter(
      (specifier) =>
        /streamdown|regex-tester|message-response|reasoning-content/.test(
          specifier,
        ),
    );

    expect(heavyImports).toEqual([]);
  });

  test("loads markdown renderers dynamically from the chat page", () => {
    const source = parse("apps/web/app/(chat)/components/chat-page.tsx");
    const renderers = [
      "@workspace/ui/components/ai-elements/message-response",
      "@workspace/ui/components/ai-elements/reasoning-content",
    ];

    expect(staticImports(source)).not.toEqual(
      expect.arrayContaining(renderers),
    );
    expect(dynamicImports(source)).toEqual(expect.arrayContaining(renderers));
  });
});
