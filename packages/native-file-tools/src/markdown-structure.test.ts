import { describe, expect, it } from "vitest";
import { splitSourceLines } from "./source-lines";
import {
  createMarkdownScanner,
  scanMarkdownStructure,
  type MarkdownHeading,
  type MarkdownLine,
  type MarkdownLineRole,
  type MarkdownSpan,
} from "./markdown-structure";

type ScanResult = { lines: Array<MarkdownLine>; spans: Array<MarkdownSpan> };

function heading(
  depth: number,
  line: number,
  headEnd: number,
  label: string,
): MarkdownHeading {
  return { depth, line, headEnd, label };
}

function line(
  lineNumber: number,
  text: string,
  role: MarkdownLineRole,
  headingValue?: MarkdownHeading,
): MarkdownLine {
  return headingValue === undefined
    ? { line: lineNumber, text, role }
    : { line: lineNumber, text, role, heading: headingValue };
}

function span(
  head: MarkdownHeading,
  endLine: number,
  kind: MarkdownSpan["kind"] = "heading",
): MarkdownSpan {
  return { kind, ...head, endLine };
}

function scan(source: string): ScanResult {
  const lines: Array<MarkdownLine> = [];
  const spans: Array<MarkdownSpan> = [];
  const scanner = createMarkdownScanner({
    onLine: (value) => {
      lines.push(value);
    },
    onSpan: (value) => {
      spans.push(value);
    },
  });

  for (const nativeLine of splitSourceLines(source)) {
    if (!scanner.push(nativeLine)) break;
  }
  scanner.end();
  return { lines, spans };
}

describe("markdown structure scanner", () => {
  it("recognizes ATX depths, closing hashes, and empty headings", () => {
    const source = [
      "# one\n",
      "## two\n",
      "### three\n",
      "#### four\n",
      "##### five\n",
      "###### six\n",
      "#NoSpace\n",
      "    # indented code\n",
      "## title ##\n",
      "#\n",
    ].join("");
    const result = scan(source);

    expect(result.lines).toEqual([
      line(1, "# one\n", "heading", heading(1, 1, 1, "# one")),
      line(2, "## two\n", "heading", heading(2, 2, 2, "## two")),
      line(3, "### three\n", "heading", heading(3, 3, 3, "### three")),
      line(4, "#### four\n", "heading", heading(4, 4, 4, "#### four")),
      line(5, "##### five\n", "heading", heading(5, 5, 5, "##### five")),
      line(6, "###### six\n", "heading", heading(6, 6, 6, "###### six")),
      line(7, "#NoSpace\n", "content"),
      line(8, "    # indented code\n", "content"),
      line(9, "## title ##\n", "heading", heading(2, 9, 9, "## title ##")),
      line(10, "#\n", "heading", heading(1, 10, 10, "#")),
    ]);
    expect(result.spans).toEqual([
      span(heading(6, 6, 6, "###### six"), 8),
      span(heading(5, 5, 5, "##### five"), 8),
      span(heading(4, 4, 4, "#### four"), 8),
      span(heading(3, 3, 3, "### three"), 8),
      span(heading(2, 2, 2, "## two"), 8),
      span(heading(2, 9, 9, "## title ##"), 9),
      span(heading(1, 1, 1, "# one"), 9),
      span(heading(1, 10, 10, "#"), 10),
    ]);
  });

  it("recognizes depth-one and depth-two setext headings and multi-line text", () => {
    const source = "Title\nsubtitle\n===\nSecond\n---\n";
    const result = scan(source);
    const first = heading(1, 1, 3, "Title");
    const second = heading(2, 4, 5, "Second");

    expect(result.lines).toEqual([
      line(1, "Title\n", "heading", first),
      line(2, "subtitle\n", "heading", first),
      line(3, "===\n", "heading", first),
      line(4, "Second\n", "heading", second),
      line(5, "---\n", "heading", second),
    ]);
    expect(result.spans).toEqual([
      span(heading(2, 4, 5, "Second"), 5),
      span(heading(1, 1, 3, "Title"), 5),
    ]);
  });

  it("closes nested sections at the next heading of equal or lesser depth", () => {
    const source = Array.from({ length: 25 }, (_, index) => {
      const lineNumber = index + 1;
      if (lineNumber === 5) return "## outer\n";
      if (lineNumber === 9) return "### inner\n";
      if (lineNumber === 20) return "## next\n";
      return `body ${lineNumber}\n`;
    }).join("");
    const result = scan(source);

    expect(result.spans).toEqual([
      span(heading(3, 9, 9, "### inner"), 19),
      span(heading(2, 5, 5, "## outer"), 19),
      span(heading(2, 20, 20, "## next"), 25),
    ]);
  });

  it("keeps duplicate headings as separate spans", () => {
    const result = scan("# Same\nbody\n# Same\n");

    expect(result.lines).toEqual([
      line(1, "# Same\n", "heading", heading(1, 1, 1, "# Same")),
      line(2, "body\n", "content"),
      line(3, "# Same\n", "heading", heading(1, 3, 3, "# Same")),
    ]);
    expect(result.spans).toEqual([
      span(heading(1, 1, 1, "# Same"), 2),
      span(heading(1, 3, 3, "# Same"), 3),
    ]);
  });

  it("hides headings in fenced code and recognizes headings after longer closers", () => {
    const result = scan(
      [
        "```js\n",
        "# hidden backtick\n",
        "````\n",
        "# visible backtick\n",
        "~~~\n",
        "# hidden tilde\n",
        "~~~~\n",
        "# visible tilde\n",
      ].join(""),
    );

    expect(result.spans).toEqual([
      span(heading(1, 4, 4, "# visible backtick"), 7),
      span(heading(1, 8, 8, "# visible tilde"), 8),
    ]);
  });

  it("hides headings in an unclosed fence and in indented code", () => {
    expect(scan("~~~\n# hidden to EOF\n").spans).toEqual([]);
    expect(scan("    # hidden\n# visible\n").spans).toEqual([
      span(heading(1, 2, 2, "# visible"), 2),
    ]);
  });

  it("hides headings in several HTML blocks and resumes after their closers", () => {
    const source = [
      "<div>\n",
      "# hidden in div\n",
      "\n",
      "# visible after div\n",
      "<!--\n",
      "# hidden in comment\n",
      "-->\n",
      "# visible after comment\n",
    ].join("");
    const result = scan(source);

    expect(result.spans).toEqual([
      span(heading(1, 4, 4, "# visible after div"), 7),
      span(heading(1, 8, 8, "# visible after comment"), 8),
    ]);
    expect(result.lines).toEqual([
      line(1, "<div>\n", "content"),
      line(2, "# hidden in div\n", "content"),
      line(3, "\n", "blank"),
      line(
        4,
        "# visible after div\n",
        "heading",
        heading(1, 4, 4, "# visible after div"),
      ),
      line(5, "<!--\n", "content"),
      line(6, "# hidden in comment\n", "content"),
      line(7, "-->\n", "content"),
      line(
        8,
        "# visible after comment\n",
        "heading",
        heading(1, 8, 8, "# visible after comment"),
      ),
    ]);
  });

  it("excludes list and blockquote headings while recognizing a root heading", () => {
    const result = scan("- # in list\n> ## in quote\n# Real\n");

    expect(result.lines).toEqual([
      line(1, "- # in list\n", "content"),
      line(2, "> ## in quote\n", "content"),
      line(3, "# Real\n", "heading", heading(1, 3, 3, "# Real")),
    ]);
    expect(result.spans).toEqual([span(heading(1, 3, 3, "# Real"), 3)]);
  });

  it("recognizes a heading after a list ends at a blank non-indented line", () => {
    const result = scan("- item\n\n# after list\n");

    expect(result.lines).toEqual([
      line(1, "- item\n", "content"),
      line(2, "\n", "blank"),
      line(3, "# after list\n", "heading", heading(1, 3, 3, "# after list")),
    ]);
    expect(result.spans).toEqual([span(heading(1, 3, 3, "# after list"), 3)]);
  });

  it("keeps a lazy blockquote continuation out of root headings", () => {
    const result = scan("> quote\nlazy continuation\n===\n# Real\n");

    expect(result.lines).toEqual([
      line(1, "> quote\n", "content"),
      line(2, "lazy continuation\n", "content"),
      line(3, "===\n", "content"),
      line(4, "# Real\n", "heading", heading(1, 4, 4, "# Real")),
    ]);
    expect(result.spans).toEqual([span(heading(1, 4, 4, "# Real"), 4)]);
  });

  it("starts a setext heading after its link reference definitions", () => {
    const result = scan("[foo]: /url\nbar\n===\n");
    const bar = heading(1, 2, 3, "bar");

    expect(result.lines).toEqual([
      line(1, "[foo]: /url\n", "content"),
      line(2, "bar\n", "heading", bar),
      line(3, "===\n", "heading", bar),
    ]);
    expect(scan("[foo]: /url\n===\n").spans).toEqual([]);
  });

  // Each start line matches the definitions mdast splits off these inputs.
  it.each([
    ["angle destination", "[a]: <my url>\nbar\n===\n", 2],
    ["balanced parentheses", "[a]: /u(r(l))\nbar\n===\n", 2],
    ["escaped parenthesis", "[a]: /u\\(x\nbar\n===\n", 2],
    ["unbalanced parenthesis", "[a]: /u(x\nbar\n===\n", 1],
    ["quoted title", '[a]: /url "title"\nbar\n===\n', 2],
    ["title followed by text", '[a]: /url "title" junk\nbar\n===\n', 1],
    ["destination on the next line", "[a]:\n/url\nbar\n===\n", 3],
    ["title on the next line", '[a]: /url\n"title"\nbar\n===\n', 3],
    ["rejected next-line title", '[a]: /url\n"title" junk\nbar\n===\n', 2],
    ["blank label", "[ ]: /url\nbar\n===\n", 1],
    ["unclosed angle destination", "[a]: <bad\nbar\n===\n", 1],
    ["missing colon", "[a] /url\nbar\n===\n", 1],
    ["two definitions", "[a]: /1\n[b]: /2\nbar\n===\n", 3],
    ["single-quoted title", "[a]: /url 'x'\nbar\n===\n", 2],
    ["parenthesized title", "[a]: /url (x)\nbar\n===\n", 2],
  ])("starts the setext heading after a %s definition", (_, source, start) => {
    expect(
      scan(source).spans.map(({ line: lineNumber }) => lineNumber),
    ).toEqual([start]);
  });

  it("distinguishes a thematic break after a blank from a setext underline", () => {
    expect(scan("\n---\n").lines).toEqual([
      line(1, "\n", "blank"),
      line(2, "---\n", "content"),
    ]);
    expect(scan("\n---\n").spans).toEqual([]);

    const setext = scan("Two\n---\n");
    expect(setext.lines).toEqual([
      line(1, "Two\n", "heading", heading(2, 1, 2, "Two")),
      line(2, "---\n", "heading", heading(2, 1, 2, "Two")),
    ]);
    expect(setext.spans).toEqual([span(heading(2, 1, 2, "Two"), 2)]);
  });

  it("recognizes closed frontmatter and excludes its apparent heading", () => {
    const result = scan("---\ntitle: X\n# not heading\n---\n# Real\n");

    expect(result.lines).toEqual([
      line(1, "---\n", "frontmatter"),
      line(2, "title: X\n", "frontmatter"),
      line(3, "# not heading\n", "frontmatter"),
      line(4, "---\n", "frontmatter"),
      line(5, "# Real\n", "heading", heading(1, 5, 5, "# Real")),
    ]);
    expect(result.spans).toEqual([
      span(heading(0, 1, 4, "---"), 4, "frontmatter"),
      span(heading(1, 5, 5, "# Real"), 5),
    ]);
  });

  it("accepts an ellipsis closer and delimiter trailing spaces", () => {
    const result = scan("---   \t\ntitle: X\n... \t\n# Real\n");

    expect(result.lines).toEqual([
      line(1, "---   \t\n", "frontmatter"),
      line(2, "title: X\n", "frontmatter"),
      line(3, "... \t\n", "frontmatter"),
      line(4, "# Real\n", "heading", heading(1, 4, 4, "# Real")),
    ]);
    expect(result.spans).toEqual([
      span(heading(0, 1, 3, "---   \t"), 3, "frontmatter"),
      span(heading(1, 4, 4, "# Real"), 4),
    ]);
  });

  it("recognizes CRLF frontmatter delimiters and strips only the delimiter CR", () => {
    const result = scan("---\r\n# not heading\r\n---\r\n# Real\r\n");

    expect(result.lines).toEqual([
      line(1, "---\r\n", "frontmatter"),
      line(2, "# not heading\r\n", "frontmatter"),
      line(3, "---\r\n", "frontmatter"),
      line(4, "# Real\r\n", "heading", heading(1, 4, 4, "# Real")),
    ]);
    expect(result.spans).toEqual([
      span(heading(0, 1, 3, "---"), 3, "frontmatter"),
      span(heading(1, 4, 4, "# Real"), 4),
    ]);
  });

  it("treats an unclosed opener as ordinary Markdown", () => {
    const result = scan("---\ntitle: X\n===\n");

    expect(result.lines).toEqual([
      line(1, "---\n", "content"),
      line(2, "title: X\n", "heading", heading(1, 2, 3, "title: X")),
      line(3, "===\n", "heading", heading(1, 2, 3, "title: X")),
    ]);
    expect(result.spans).toEqual([span(heading(1, 2, 3, "title: X"), 3)]);
  });

  it("does not treat a delimiter away from line one as frontmatter", () => {
    const result = scan("title\n---\n");

    expect(result.lines).toEqual([
      line(1, "title\n", "heading", heading(2, 1, 2, "title")),
      line(2, "---\n", "heading", heading(2, 1, 2, "title")),
    ]);
    expect(result.spans).toEqual([span(heading(2, 1, 2, "title"), 2)]);
  });

  it("uses native LF lines while preserving CRLF labels without the CR", () => {
    const result = scan("# one\r\n# two\r\n");

    expect(result.lines).toEqual([
      line(1, "# one\r\n", "heading", heading(1, 1, 1, "# one")),
      line(2, "# two\r\n", "heading", heading(1, 2, 2, "# two")),
    ]);
    expect(result.spans).toEqual([
      span(heading(1, 1, 1, "# one"), 1),
      span(heading(1, 2, 2, "# two"), 2),
    ]);
  });

  it("keeps two headings on one native line when lone CR is a Markdown break", () => {
    const result = scan("# a\r# b\n");

    expect(
      result.lines.map(({ line: lineNumber, text }) => ({
        line: lineNumber,
        text,
      })),
    ).toEqual([{ line: 1, text: "# a\r# b\n" }]);
    expect(result.spans).toEqual([
      span(heading(1, 1, 1, "# a\r# b"), 1),
      span(heading(1, 1, 1, "# a\r# b"), 1),
    ]);
  });

  it("emits no events for empty input and marks headingless lines", () => {
    expect(scan("")).toEqual({ lines: [], spans: [] });
    expect(scan("plain\n\nmore")).toEqual({
      lines: [
        line(1, "plain\n", "content"),
        line(2, "\n", "blank"),
        line(3, "more", "content"),
      ],
      spans: [],
    });
  });

  it("reports a line holding only a container marker as content", () => {
    expect(scan("# H\n>\n-\n1.\n  \n").lines).toEqual([
      line(1, "# H\n", "heading", heading(1, 1, 1, "# H")),
      line(2, ">\n", "content"),
      line(3, "-\n", "content"),
      line(4, "1.\n", "content"),
      line(5, "  \n", "blank"),
    ]);
  });

  it("ignores a leading byte order mark but keeps it in the text", () => {
    expect(scan("\uFEFF# Title\n").lines).toEqual([
      line(1, "\uFEFF# Title\n", "heading", heading(1, 1, 1, "\uFEFF# Title")),
    ]);
    expect(scan("\uFEFF---\ntitle: x\n---\n# Real\n").spans).toEqual([
      span(heading(0, 1, 3, "\uFEFF---"), 3, "frontmatter"),
      span(heading(1, 4, 4, "# Real"), 4),
    ]);
  });

  it("stops after an onSpan callback returns false", () => {
    const lines: Array<MarkdownLine> = [];
    const spans: Array<MarkdownSpan> = [];
    const scanner = createMarkdownScanner({
      onLine: (value) => {
        lines.push(value);
      },
      onSpan: (value) => {
        spans.push(value);
        return false;
      },
    });

    const pushes = [
      scanner.push("# one\n"),
      scanner.push("# two\n"),
      scanner.push("# three\n"),
    ];
    scanner.end();

    expect(pushes).toEqual([true, false, false]);
    // The span of `# one` closes when `# two` opens, before line 2 is reported.
    expect(lines).toEqual([
      line(1, "# one\n", "heading", heading(1, 1, 1, "# one")),
    ]);
    expect(spans).toEqual([span(heading(1, 1, 1, "# one"), 1)]);
  });

  it("stops after an onLine callback returns false", () => {
    const lines: Array<MarkdownLine> = [];
    const spans: Array<MarkdownSpan> = [];
    const scanner = createMarkdownScanner({
      onLine: (value) => {
        lines.push(value);
        return value.line === 1 ? undefined : false;
      },
      onSpan: (value) => {
        spans.push(value);
      },
    });

    const pushes = [
      scanner.push("# one\n"),
      scanner.push("# two\n"),
      scanner.push("# three\n"),
    ];
    scanner.end();

    expect(pushes).toEqual([true, false, false]);
    expect(lines).toEqual([
      line(1, "# one\n", "heading", heading(1, 1, 1, "# one")),
      line(2, "# two\n", "heading", heading(1, 2, 2, "# two")),
    ]);
    expect(spans).toEqual([span(heading(1, 1, 1, "# one"), 1)]);
  });

  it("stops inside frontmatter when onLine returns false", () => {
    const lines: Array<MarkdownLine> = [];
    const spans: Array<MarkdownSpan> = [];
    const scanner = createMarkdownScanner({
      onLine: (value) => {
        lines.push(value);
        return value.line < 2;
      },
      onSpan: (value) => {
        spans.push(value);
      },
    });

    for (const nativeLine of ["---\n", "a: 1\n", "---\n", "# H\n"]) {
      scanner.push(nativeLine);
    }
    scanner.end();

    expect(lines.map(({ line: lineNumber }) => lineNumber)).toEqual([1, 2]);
    expect(spans).toEqual([]);
  });

  it("stops pulling input once a span callback returns false", () => {
    const pulled: Array<number> = [];
    function* source(): Generator<string> {
      for (let index = 1; index <= 5; index += 1) {
        pulled.push(index);
        yield `# ${index}\n`;
      }
    }

    scanMarkdownStructure(source(), () => false);

    expect(pulled).toEqual([1, 2]);
  });
});
