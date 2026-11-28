import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, test } from "vitest";

/*
 * The signed-in shell is mounted once, by the `(app)` layout, so Chats,
 * Settings and Administration all show the same main rail (New chat, Search,
 * the chat list) and moving between them keeps one live connection. An area
 * layout that mounted the shell again would draw a second rail and open a
 * second live connection, which typecheck and lint both accept.
 */

const appRoot = import.meta.dirname;

/** The JSX element names a layout file renders. */
function renderedElements(relativePath: string): Array<string> {
  const absolutePath = path.join(appRoot, relativePath);

  const source = ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const names: Array<string> = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      names.push(node.tagName.getText(source));
    }

    ts.forEachChild(node, visit);
  }

  visit(source);

  return names;
}

const SHELL = [
  "AppShellFrame",
  "SidebarProvider",
  "LiveUpdatesProvider",
  "ActiveRunsProvider",
  "CommandPaletteProvider",
  "AppSidebar",
];

const AREA_LAYOUTS = [
  "(chat)/layout.tsx",
  "(settings)/settings/layout.tsx",
  "(admin)/admin/layout.tsx",
];

describe("the signed-in layout", () => {
  test("mounts the shell and the main rail with its New chat and Search actions once", () => {
    const elements = renderedElements("layout.tsx");

    for (const name of SHELL) {
      expect(elements.filter((element) => element === name)).toEqual([name]);
    }

    expect(elements).toContain("AppSidebarActions");
  });

  test.each(AREA_LAYOUTS)(
    "%s adds its own page chrome without a second shell",
    (layout) => {
      const elements = renderedElements(layout);

      expect(elements).toContain("SidebarInset");
      expect(elements.filter((element) => SHELL.includes(element))).toEqual([]);
    },
  );
});
