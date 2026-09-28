import * as commonmarkSpec from "commonmark-spec";
import { beforeAll, describe, expect, it } from "vitest";
import { splitSourceLines } from "./source-lines";
import { scanMarkdownStructure, type MarkdownSpan } from "./markdown-structure";

// mdast-util-from-markdown is ESM-only; this package compiles as CommonJS.
const loadMdast = () => import("mdast-util-from-markdown");
let fromMarkdown: Awaited<ReturnType<typeof loadMdast>>["fromMarkdown"];

type RootHeading = { depth: number; line: number; headEnd: number };
type Fixture = { name: string; source: string };

/** mdast starts a setext heading at the link reference definitions that
 *  open its paragraph; the scanner starts it at the first heading text line,
 *  as the unit suite asserts. */
const EXCLUDED = new Map([
  [
    215,
    "setext heading position includes a preceding link reference definition",
  ],
]);

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
    name: "paragraph interrupted by ATX",
    source: "paragraph\n# heading\ncontinuation\n",
  },
];

function delimiterText(nativeLine: string): string {
  let text = nativeLine.endsWith("\n") ? nativeLine.slice(0, -1) : nativeLine;
  if (text.endsWith("\r")) text = text.slice(0, -1);
  return text.replace(/[ \t]+$/u, "");
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
      index <= closer ? nativeLine.replaceAll(/[^\r\n]/gu, " ") : nativeLine,
    )
    .join("");
}

function nativeLineAtOffset(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function requiredOffset(offset: number | undefined): number {
  if (offset === undefined) throw new Error("Expected a source offset");
  return offset;
}

function compareHeadings(left: RootHeading, right: RootHeading): number {
  return (
    left.line - right.line ||
    left.headEnd - right.headEnd ||
    left.depth - right.depth
  );
}

function expectedHeadings(source: string): Array<RootHeading> {
  const markdown = blankClosedFrontmatter(source);
  const tree = fromMarkdown(markdown);
  const expected: Array<RootHeading> = [];

  for (const child of tree.children) {
    if (child.type !== "heading") continue;
    if (child.position === undefined) {
      throw new Error("Expected every heading to have a source position");
    }
    expected.push({
      depth: child.depth,
      line: nativeLineAtOffset(
        source,
        requiredOffset(child.position.start.offset),
      ),
      headEnd: nativeLineAtOffset(
        source,
        requiredOffset(child.position.end.offset),
      ),
    });
  }

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

describe("markdown structure CommonMark conformance", () => {
  beforeAll(async () => {
    ({ fromMarkdown } = await loadMdast());
  });

  const commonmarkCases = commonmarkSpec.tests.flatMap((test) =>
    !EXCLUDED.has(test.number)
      ? [
          {
            markdown: test.markdown.replaceAll("→", "\t"),
            section: test.section,
            example: test.number,
          },
        ]
      : [],
  );

  it("loads the whole CommonMark 0.31.2 example corpus", () => {
    expect(commonmarkSpec.tests).toHaveLength(652);
  });

  it.each(commonmarkCases)("example $example ($section)", ({ markdown }) => {
    expect(actualHeadings(markdown)).toEqual(expectedHeadings(markdown));
  });

  it.each(FIXTURES)("fixture $name", ({ source }) => {
    expect(actualHeadings(source)).toEqual(expectedHeadings(source));
  });
});
