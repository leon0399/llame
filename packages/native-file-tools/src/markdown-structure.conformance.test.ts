import * as commonmarkSpec from "commonmark-spec";
import { beforeAll, describe, expect, it } from "vitest";
import type { fromMarkdown as ParseMarkdown } from "mdast-util-from-markdown";
import type { gfmTableFromMarkdown as GfmTableExtension } from "mdast-util-gfm-table";
import type { gfmTable as GfmTableSyntax } from "micromark-extension-gfm-table";
import { splitSourceLines } from "./source-lines";
import {
  createMarkdownScanner,
  scanMarkdownStructure,
  type MarkdownSpan,
} from "./markdown-structure";
import { MarkdownRootTableTracker } from "./markdown-tables";

// mdast-util-from-markdown and the GFM extensions are ESM-only; this package
// compiles as CommonJS, so only their types are imported normally.
const loadMdast = () => import("mdast-util-from-markdown");
const loadGfmTable = () => import("micromark-extension-gfm-table");
const loadMdastGfmTable = () => import("mdast-util-gfm-table");
let fromMarkdown: typeof ParseMarkdown;
let gfmTable: typeof GfmTableSyntax;
let gfmTableFromMarkdown: typeof GfmTableExtension;

type RootHeading = { depth: number; line: number; headEnd: number };
type Fixture = { name: string; source: string };
/** A root table: its header row to its last body row. */
type TableSpan = { startLine: number; endLine: number };

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: "ATX headings",
    source: "# one\n## two\n# three #\n",
  },
  {
    name: "setext headings",
    source: "Title\nsubtitle\n===\nTwo\n---\n",
  },
  {
    name: "duplicate headings",
    source: "# Same\nbody\n# Same\n",
  },
  {
    name: "fenced code",
    source:
      "```md\n# hidden\n````\n# shown\n~~~\n## hidden\n~~~~\n# shown again\n",
  },
  {
    name: "indented code",
    source: "    # hidden\n# shown\n    still code\n\n## shown two\n",
  },
  {
    name: "HTML blocks",
    source:
      "<div>\n# hidden in div\n\n# shown\n<!--\n# hidden in comment\n-->\n# shown again\n<script>\n# hidden in script\n</script>\n# shown final\n",
  },
  {
    name: "list and blockquote headings",
    source:
      "- # hidden in list\n> ## hidden in quote\n# root\n- item\n\n## after list\n> quote\n# lazy continuation\n\n### final\n",
  },
  {
    name: "closed frontmatter",
    source: "---\ntitle: x\n# hidden\n...\n# visible\n",
  },
  {
    name: "unclosed frontmatter",
    source: "---\ntitle: x\n===\n",
  },
  {
    name: "lone CR",
    source: "# one\r# two\n",
  },
  {
    name: "CRLF",
    source: "# one\r\n# two\r\n",
  },
  {
    name: "trailing LF",
    source: "# one\n",
  },
  {
    name: "two headings on one native line",
    source: "# one\r## two\n",
  },
  {
    name: "link reference definitions before setext",
    source: "[a]: /1\n[b]: /2 'title'\nbar\nbaz\n===\n",
  },
  {
    name: "byte order mark before a heading",
    source: "\uFEFF# Title\nbody\n",
  },
  {
    name: "byte order mark before frontmatter",
    source: "\uFEFF---\ntitle: x\n---\n# Real\n",
  },
];

/** Fixtures where GFM and CommonMark agree on every heading, so the GFM tree
 *  is the oracle for both. */
const TABLE_FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: "a table after a one-line paragraph",
    source: "para\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table after a multi-line paragraph",
    source: "para\nmore\na | b\n-|-\n1|2\n",
  },
  {
    name: "mismatched cell counts are not a table",
    source: "a | b\n-|-|-\n1 | 2 | 3\n",
  },
  { name: "a header without outer pipes", source: "a | b\n-|-\n1|2\n" },
  { name: "aligned delimiter cells", source: "a | b\n:- | -:\n1 | 2\n" },
  {
    name: "a delimiter row with a trailing pipe",
    source: "a | b\n-|-|\n1|2\n",
  },
  { name: "a delimiter row with a leading pipe", source: "a | b\n|-|-\n1|2\n" },
  {
    name: "a fully aligned delimiter row",
    source: "| a | b |\n|:-:|-:|\n| 1 | 2 |\n",
  },
  {
    name: "a three-column-indented delimiter row",
    source: "| a | b |\n   | - | - |\n| 1 | 2 |\n",
  },
  { name: "a header row with outer pipes", source: "| a | b\n|-|-|\n|1|2\n" },
  { name: "a header row of two pipes", source: "||\n|-|\n|1|\n" },
  { name: "a header row ending in two pipes", source: "a||\n-|-\n1|2\n" },
  {
    name: "a following line without a pipe is a body row",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\nno pipe\n",
  },
  {
    name: "a link reference definition and an ATX-looking line continue a body",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n[a]: /1\n#x\n",
  },
  {
    name: "an ATX heading ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n# H\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a fence ends a table",
    source:
      "| a | b |\n| - | - |\n| 1 | 2 |\n~~~\nx | y\n~~~\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a thematic break ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n***\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a blockquote ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n> q\nx | y\n-|-\n1|2\n",
  },
  {
    name: "an ordered list item ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n2. x\na | b\n-|-\n1|2\n",
  },
  {
    name: "an empty bullet item ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n*\na | b\n-|-\n1|2\n",
  },
  {
    name: "an HTML block ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n<div>\na | b\n-|-\n1|2\n",
  },
  {
    name: "a lone HTML line ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n<span>\nx | y\n-|-\n1|2\n",
  },
  {
    name: "indented code ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n    code\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a blank line ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n\nx | y\n-|-\n1|2\n",
  },
  {
    name: "an inline HTML tag line is a body row",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n<span>x</span>\n",
  },
  {
    name: "an escaped pipe does not split a cell",
    source: "a \\| b | c\n-|-\n1|2\n",
  },
  {
    name: "a doubly backslashed pipe splits a cell",
    source: "a \\\\| b | c\n-|-|-\n1|2|3\n",
  },
  {
    name: "a pipe in a code span splits a cell",
    source: "| `a|b` | c |\n| - | - |\n| 1 | 2 |\n",
  },
  {
    name: "a pipe in an autolink splits a cell",
    source: "a | <b|c>\n-|-\n1|2\n",
  },
  {
    name: "a pipe in a link destination splits a cell",
    source: "a | [t](x|y)\n-|-\n1|2\n",
  },
  {
    name: "a table inside a blockquote is not a root table",
    source: "> | a | b |\n> | - | - |\n> | 1 | 2 |\n> | 3 | 4 |\n",
  },
  {
    name: "a table inside a list item is not a root table",
    source: "- | a | b |\n  | - | - |\n  | 1 | 2 |\n  | 3 | 4 |\n",
  },
  {
    name: "a four-space-indented header after a paragraph is not a table",
    source: "para\n    a | b\n    -|-\n    x | y\n",
  },
  {
    name: "a four-space-indented table is not a table",
    source: "    a | b\n    -|-\n    x | y\n",
  },
  {
    name: "a list item is not a delimiter row",
    source: "a | b\n- | -\n1 | 2\n",
  },
  {
    name: "a link reference definition can be a header row",
    source: "[a]: /1\nb | c\n-|-\n1|2\n",
  },
  { name: "a lone pipe header has no cells", source: "|\n|-|\n1|2\n" },
  {
    name: "a byte order mark before the header row is ignored",
    source: "\uFEFF| a | b\n| - | - |\n| 1 | 2 |\n",
  },
  {
    name: "rows after a list item that ended a table are not a table",
    source: "x | y\n-|-\n1|2\n2. x\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table after an ATX heading that ended a table has a header",
    source: "x | y\n-|-\n1|2\n2. x\n# H\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table after a thematic break that ended a table has a header",
    source: "x | y\n-|-\n1|2\n2. x\n***\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table after a fence that ended a table has a header",
    source: "x | y\n-|-\n1|2\n2. x\n~~~\na | b\n~~~\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a table after a blockquote and blank that ended a table has a header",
    source: "x | y\n-|-\n1|2\n2. x\n> q\n\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table indented to a content column stays in its list",
    source: "x | y\n-|-\n1|2\n2. x\n\n   a | b\n   -|-\n   1|2\n",
  },
  {
    name: "rows after a list of another type are not a table",
    source: "x | y\n-|-\n1|2\n2. x\n3) y\na | b\n-|-\n1|2\n",
  },
  {
    name: "rows after a chained list of another type are not a table",
    source: "x | y\n-|-\n1|2\n2. x\n3) y\n4. z\na | b\n-|-\n1|2\n",
  },
  {
    name: "rows after a bullet item that ended a table are not a table",
    source: "x | y\n-|-\n1|2\n2. x\n- y\na | b\n-|-\n1|2\n",
  },
  {
    name: "rows after a blockquote that ended a table are not a table",
    source: "x | y\n-|-\n1|2\n2. x\n> q\na | b\n-|-\n1|2\n",
  },
  {
    name: "an empty item ends the list a table ended",
    source: "x | y\n-|-\n1|2\n2. x\n1)\na | b\n-|-\n1|2\n",
  },
  {
    name: "an empty bullet item ends the list a table ended",
    source: "x | y\n-|-\n1|2\n*\na | b\n-|-\n1|2\n",
  },
  {
    name: "a lone HTML line inside a list does not suppress the next table",
    source: "x | y\n-|-\n1|2\n2. x\n<span>\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table indented to an item content column stays in its list",
    source: "x | y\n-|-\n1|2\n2. x\n   a | b\n   -|-\n   1|2\n",
  },
  {
    name: "a table indented to a sibling item content column stays in its list",
    source: "x | y\n-|-\n1|2\n2. x\n\n3. y\n   a | b\n   -|-\n   1|2\n",
  },
  {
    name: "a table indented after a sibling item stays in its list",
    source: "x | y\n-|-\n1|2\n2. x\n3. y\n   a | b\n   -|-\n   1|2\n",
  },
  { name: "a setext underline is not a delimiter row", source: "a | b\n---\n" },
  {
    name: "a three-line setext underline is not a delimiter row",
    source: "a | b\nc | d\n---\n",
  },
  {
    name: "a table after a one-column-indented heading that ended a table",
    source: "x | y\n-|-\n1|2\n2. x\n # H\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table after a two-column-indented heading that ended a table",
    source: "x | y\n-|-\n1|2\n2. x\n  # H\na | b\n-|-\n1|2\n",
  },
  {
    name: "a table after a blank line inside a list that ended a table",
    source: "x | y\n-|-\n1|2\n2. x\n<span>\n\na | b\n-|-\n1|2\n",
  },
  { name: "a single-cell delimiter row", source: "a\n:-\n1\n" },
  {
    name: "a backtick fence ends a table",
    source:
      "| a | b |\n| - | - |\n| 1 | 2 |\n```\nx | y\n```\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a closed script block ends a table",
    source:
      "| a | b |\n| - | - |\n| 1 | 2 |\n<script>\nx\n</script>\na | b\n-|-\n1|2\n",
  },
  {
    name: "an empty ordered item line ends a table",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n2.\nx | y\n-|-\n1|2\n",
  },
  {
    name: "indented code after a list item that ended a table",
    source: "x | y\n-|-\n1|2\n2. x\n    code\nx | y\n-|-\n1|2\n",
  },
  {
    name: "item-relative indented code after a list item that ended a table",
    source: "x | y\n-|-\n1|2\n2. x\n       code\nx | y\n-|-\n1|2\n",
  },
  {
    name: "item-relative indented code before a blank after a list item",
    source: "x | y\n-|-\n1|2\n2. x\n       code\n\nx | y\n-|-\n1|2\n",
  },
  {
    name: "a paragraph line at the content column after a list item",
    source: "x | y\n-|-\n1|2\n2. x\n   more\na | b\n-|-\n1|2\n",
  },
  { name: "a lone pipe header and delimiter pair", source: "|\n|\n1|2\n" },
  {
    name: "an ordered list marker that cannot interrupt a paragraph is not a list",
    source: "para\n2. item\na | b\n-|-\n1|2\n",
  },
  {
    name: "a tab-surrounded delimiter row",
    source: "| a | b |\n|\t---\t|\t---\t|\n| 1 | 2 |\n",
  },
  {
    name: "a tab-surrounded aligned delimiter row",
    source: "| a | b |\n|\t:---\t|\t---:\t|\n| 1 | 2 |\n",
  },
  {
    name: "a spaced thematic break ends the list a table ended",
    source: "x | y\n-|-\n1|2\n2. x\n* * *\na | b\n-|-\n1|2\n",
  },
  {
    name: "a spaced hyphen thematic break ends the list a table ended",
    source: "x | y\n-|-\n1|2\n2. x\n- - -\na | b\n-|-\n1|2\n",
  },
  {
    name: "an indented paragraph line continues a wide list item",
    source: "x | y\n-|-\n1|2\n2.   x\n    more\na | b\n-|-\n1|2\n3|4\n",
  },
  {
    name: "a lone HTML line inside an item that ended a table",
    source: "x | y\n-|-\n1|2\n2. x\n   <span>\na | b\n-|-\n1|2\n",
  },
  {
    name: "a lone HTML line after an empty item that ended a table",
    source: "x | y\n-|-\n1|2\n2.\n<span>\na | b\n-|-\n1|2\n",
  },
  {
    name: "indented code inside an item whose paragraph is open",
    source: "x | y\n-|-\n1|2\n2. x\n       more\na | b\n-|-\n1|2\n",
  },
  {
    name: "indented code inside an item after a blank",
    source: "x | y\n-|-\n1|2\n2. x\n\n       more\na | b\n-|-\n1|2\n",
  },
  {
    name: "an indented ATX line inside an item is code, not a heading",
    source: "x | y\n-|-\n1|2\n2. x\n       # H\na | b\n-|-\n1|2\n",
  },
  {
    name: "an indented fence inside an item is code, not a fence",
    source: "x | y\n-|-\n1|2\n2. x\n       ~~~\na | b\n-|-\n1|2\n",
  },
];

/** Fixtures where this overlay deliberately keeps the CommonMark heading
 *  result against GFM (proposal T4 and the frontmatter contract). `tables` is
 *  what the tracker reports for that source. */
const DIVERGENT_TABLE_FIXTURES: ReadonlyArray<
  Fixture & { tables: ReadonlyArray<TableSpan> }
> = [
  {
    name: "frontmatter hides the tables it contains",
    source: "---\na | b\n-|-\n1|2\n---\n",
    tables: [],
  },
  {
    name: "a setext heading of equals signs over table lines takes precedence",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n===\n",
    tables: [],
  },
  {
    name: "a short setext underline over table lines takes precedence",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n=\n",
    tables: [],
  },
  {
    name: "a setext underline over table lines and text takes precedence",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\ntext\n===\n",
    tables: [],
  },
  {
    name: "a setext heading of hyphens over table lines takes precedence",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n---\n",
    tables: [],
  },
  {
    name: "a short hyphen underline over table lines takes precedence",
    source: "| a | b |\n| - | - |\n| 1 | 2 |\n-\n",
    tables: [],
  },
  {
    name: "a three-column-indented heading stays a root heading",
    source: "x | y\n-|-\n1|2\n2. x\n   # H\na | b\n-|-\n1|2\n",
    tables: [
      { startLine: 1, endLine: 3 },
      { startLine: 6, endLine: 8 },
    ],
  },
  {
    name: "a link reference definition title stays root text",
    source: "# R\n[a]: /u '\n| h |\n| - |\n'\n| b |\n===\nx\ny\nz\n",
    tables: [{ startLine: 3, endLine: 5 }],
  },
  {
    name: "a heading after a lone HTML line stays a root heading",
    source: "x | y\n-|-\n1|2\n<span>\n# H\na | b\n-|-\n1|2\n",
    tables: [{ startLine: 1, endLine: 3 }],
  },
  {
    name: "a type-6 HTML line inside an item hides the table the oracle opens",
    source: "x | y\n-|-\n1|2\n2. x\n   <div>\na | b\n-|-\n1|2\n",
    tables: [{ startLine: 1, endLine: 3 }],
  },
  {
    name: "a lone HTML line after a blank inside an item hides the oracle's table",
    source: "x | y\n-|-\n1|2\n2. x\n\n   <span>\na | b\n-|-\n1|2\n",
    tables: [{ startLine: 1, endLine: 3 }],
  },
];

function delimiterText(nativeLine: string): string {
  let text = nativeLine.endsWith("\n") ? nativeLine.slice(0, -1) : nativeLine;
  if (text.endsWith("\r")) text = text.slice(0, -1);
  return text.replace(/^\uFEFF/u, "").replace(/[ \t]+$/u, "");
}

function closedFrontmatterCloser(source: string): number | undefined {
  const lines = splitSourceLines(source);
  if (lines.length === 0 || delimiterText(lines[0]) !== "---") {
    return undefined;
  }

  for (let index = 1; index < lines.length; index += 1) {
    const delimiter = delimiterText(lines[index]);
    if (delimiter === "---" || delimiter === "...") return index;
  }
  return undefined;
}

function blankClosedFrontmatter(source: string): string {
  const closer = closedFrontmatterCloser(source);
  if (closer === undefined) return source;

  return splitSourceLines(source)
    .map((nativeLine, index) =>
      index <= closer ? nativeLine.replaceAll(/[^\r\n]/g, " ") : nativeLine,
    )
    .join("");
}

function nativeLineAt(source: string, offset: number | undefined): number {
  if (offset === undefined) throw new Error("Expected a source offset");
  return source.slice(0, offset).split("\n").length;
}

/** Offset of the line after the one containing `offset`. */
function nextLineOffset(source: string, offset: number): number {
  if (source[offset] === "\r" && source[offset + 1] === "\n") return offset + 2;
  return offset + 1;
}

function compareHeadings(left: RootHeading, right: RootHeading): number {
  return (
    left.line - right.line ||
    left.headEnd - right.headEnd ||
    left.depth - right.depth
  );
}

function expectedHeadings(source: string, gfm = false): Array<RootHeading> {
  const text = blankClosedFrontmatter(source);
  const tree = gfm ? parseGfm(text) : fromMarkdown(text);
  const expected: Array<RootHeading> = [];

  tree.children.forEach((child, index) => {
    if (child.type !== "heading") return;
    // mdast starts a setext heading at the link reference definitions that
    // open its paragraph; the heading itself starts on the line after them.
    const previous = tree.children[index - 1];
    const definitionEnd =
      previous?.type === "definition"
        ? previous.position?.end.offset
        : undefined;
    const start = child.position?.start.offset;
    expected.push({
      depth: child.depth,
      line: nativeLineAt(
        source,
        definitionEnd !== undefined &&
          start !== undefined &&
          start < definitionEnd
          ? nextLineOffset(source, definitionEnd)
          : start,
      ),
      headEnd: nativeLineAt(source, child.position?.end.offset),
    });
  });

  return expected.sort(compareHeadings);
}

function actualHeadings(source: string): Array<RootHeading> {
  const spans: Array<MarkdownSpan> = [];
  scanMarkdownStructure(splitSourceLines(source), (value) => {
    spans.push(value);
  });

  return spans
    .flatMap(({ kind, depth, line, headEnd }) =>
      kind === "heading" ? [{ depth, line, headEnd }] : [],
    )
    .sort(compareHeadings);
}

/** The GFM tree: the table oracle, and the heading oracle wherever GFM and
 *  CommonMark agree on headings. */
function parseGfm(source: string) {
  return fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
}

function oracleTables(source: string): Array<TableSpan> {
  return parseGfm(source).children.flatMap((child) => {
    if (child.type !== "table") return [];
    const start = child.children[0]?.position?.start.line;
    const end = child.position?.end.line;
    if (start === undefined || end === undefined) return [];
    return [{ startLine: start, endLine: end }];
  });
}

/** Root tables the tracker reports, read back from the body rows it answers
 *  for: a table runs from its header row to its last such row. */
function trackedTables(source: string): Array<TableSpan> {
  const tracker = new MarkdownRootTableTracker();
  const spans: Array<TableSpan> = [];
  const scanner = createMarkdownScanner({
    onLine: (line) => {
      const pair = tracker.accept(line);
      if (pair === undefined) return;
      const last = spans.at(-1);
      if (last !== undefined && last.startLine === pair.header.line)
        last.endLine = line.line;
      else spans.push({ startLine: pair.header.line, endLine: line.line });
    },
  });

  for (const nativeLine of splitSourceLines(source)) scanner.push(nativeLine);
  scanner.end();
  return spans;
}

describe("markdown structure CommonMark conformance", () => {
  beforeAll(async () => {
    ({ fromMarkdown } = await loadMdast());
    ({ gfmTable } = await loadGfmTable());
    ({ gfmTableFromMarkdown } = await loadMdastGfmTable());
  });

  const commonmarkCases = commonmarkSpec.tests.map((test) => ({
    markdown: test.markdown.replaceAll("→", "\t"),
    section: test.section,
    example: test.number,
  }));

  it("loads the whole CommonMark 0.31.2 example corpus", () => {
    expect(commonmarkSpec.tests).toHaveLength(652);
  });

  it.each(commonmarkCases)("example $example ($section)", ({ markdown }) => {
    expect(actualHeadings(markdown)).toEqual(expectedHeadings(markdown));
  });

  it.each(FIXTURES)("fixture $name", ({ source }) => {
    expect(actualHeadings(source)).toEqual(expectedHeadings(source));
  });

  it.each(TABLE_FIXTURES)("table fixture $name", ({ source }) => {
    // GFM is the oracle only where the two agree on every heading.
    expect(expectedHeadings(source, true)).toEqual(expectedHeadings(source));
    expect(trackedTables(source)).toEqual(oracleTables(source));
  });

  it.each(DIVERGENT_TABLE_FIXTURES)(
    "divergent table fixture $name",
    ({ source, tables }) => {
      // Proposal T4 and the frontmatter contract keep the CommonMark heading
      // result where GFM disagrees; `tables` is what the overlay reports then.
      expect(actualHeadings(source)).toEqual(expectedHeadings(source));
      expect(trackedTables(source)).toEqual(tables);
    },
  );
});
