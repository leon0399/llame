it("resolves a setext underline only inside the window", () => {
  const source = "# Root\n\na | b\n-|-\n1|2\n3|4\n===\n";
  // The window ends before the underline, so the table's lines stay rows and
  // the pair's header row is emitted.
  const short = selectSourceLines(
    source,
    applySelectorSuffix("/doc.md", "5-5"),
    "text/markdown",
  );
  expect(short.content).toBe("1: # Root\n3: a | b\n4: -|-\n5: 1|2\n6: 3|4\n");
  // The longer window reaches the underline, which turns those lines into
  // heading text, and line 5 is inside that heading: no pair, no ancestor.
  const long = selectSourceLines(
    source,
    applySelectorSuffix("/doc.md", "5-6"),
    "text/markdown",
  );
  expect(long).toMatchObject({
    content: "4: -|-\n5: 1|2\n6: 3|4\n7: ===\n",
    requestedRange: { startLine: 5, endLine: 6 },
    shownRange: { startLine: 4, endLine: 7 },
  });
});

it("keeps a link reference definition title out of the header pair", () => {
  // The definition's multi-line title is root text to CommonMark, and the
  // lines after it are a setext heading, so a range below them gets the
  // heading's own text line and no header pair, in source order.
  const source = "# R\n[a]: /u '\n| h |\n| - |\n'\n| b |\n===\nx\ny\nz\n";
  const result = selectSourceLines(
    source,
    applySelectorSuffix("/doc.md", "8-8"),
    "text/markdown",
  );
  expect(result).toEqual({
    status: "success",
    kind: "file",
    path: "/doc.md",
    representation: "text",
    content: "6: | b |\n7: ===\n8: x\n9: y\n",
    requestedRanges: [{ startLine: 8, endLine: 8 }],
    shownRanges: [{ startLine: 6, endLine: 9 }],
    nextOffset: 8,
    truncated: false,
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NativeFileError,
  applySelectorSuffix,
  resolveEndRelativeSelector,
} from "./path";
import { readFile, readResolvedFile } from "./read";
import type {
  DirectoryFailure,
  DirectorySuccess,
  FileFailure,
  MultiReadSuccess,
  ReadSuccess,
} from "./read";
import type { MediaReadSuccess } from "./media";
import { selectMultiRangeLines } from "./stream-read";
import { measureNativeModelOutput } from "./serialization";
import { selectSourceLines, splitSourceLines } from "./source-lines";

/** What a native read reports, before the guard below narrows it. */
type ReadOutcome =
  | ReadSuccess
  | MediaReadSuccess
  | DirectorySuccess
  | DirectoryFailure
  | FileFailure;

const numbered = (count: number, fill = ""): string =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}${fill}\n`).join("");

/** Lines wide enough that a couple of ranges exhaust the shared result cap. */
const wide = (count: number): string =>
  Array.from(
    { length: count },
    (_, i) => `line ${i + 1} ${"y".repeat(600)}\n`,
  ).join("");

/**
 * Narrow a read outcome to the multi-range success this suite exercises.
 */
function asMulti(result: ReadOutcome): MultiReadSuccess {
  if (
    result.status !== "success" ||
    !("kind" in result) ||
    result.kind !== "file" ||
    !("requestedRanges" in result)
  )
    throw new Error("Expected multi-range file success result");
  return result;
}

describe("in-memory multi-range selection", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-multi-"));
    path = join(directory, "source");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /**
   * Run the same source and selector through the file-backed reader and the
   * in-memory walk, and hold the second to the first: the walk decides from
   * the lines it is fed, so only the line source may differ.
   */
  async function bothWays(
    source: string,
    selector: string,
  ): Promise<MultiReadSuccess> {
    await writeFile(path, source);
    const fromFile = asMulti(await readFile({ path: `${path}:${selector}` }));
    const fromMemory = selectMultiRangeLines(
      source,
      // A source already in hand knows its count, so it places the
      // end-relative members exactly as the file reader's count pass does.
      resolveEndRelativeSelector(
        applySelectorSuffix(path, selector),
        splitSourceLines(source).length,
      ),
    );
    expect(fromMemory).toEqual(fromFile);
    return fromMemory;
  }

  it("refuses a target whose end-relative members were never placed", () => {
    // The walk decides from absolute members only: an unresolved target
    // would walk nothing and report an empty multi-range request, which
    // reads as "that page is empty" rather than as an unplaced selector.
    expect(() =>
      selectMultiRangeLines(numbered(12), applySelectorSuffix(path, "4-5,99-")),
    ).toThrow("invalid_selector");
  });

  it("reads two ranges with the context a local read gives", async () => {
    const result = await bothWays(numbered(12), "4-5,7-8");
    expect(result).toMatchObject({
      requestedRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
      shownRanges: [{ startLine: 3, endLine: 9 }],
      truncated: false,
    });
    expect(result.content).toBe(
      "3: line 3\n4: line 4\n5: line 5\n6: line 6\n7: line 7\n8: line 8\n9: line 9\n",
    );
    expect(result).not.toHaveProperty("nextOffset");
  });

  it("merges touching ranges into one block", async () => {
    const result = await bothWays(numbered(12), "4-5,6-7");
    expect(result).toMatchObject({
      requestedRanges: [{ startLine: 4, endLine: 7 }],
      shownRanges: [{ startLine: 3, endLine: 8 }],
    });
  });

  it("keeps disjoint windows separate across the gap", async () => {
    const result = await bothWays(numbered(30), "4-5,12-13");
    expect(result).toMatchObject({
      requestedRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 12, endLine: 13 },
      ],
      shownRanges: [
        { startLine: 3, endLine: 6 },
        { startLine: 11, endLine: 14 },
      ],
    });
  });

  it("clips a later range at EOF", async () => {
    const result = await bothWays(numbered(12), "2-3,99-100");
    expect(result).toMatchObject({
      shownRanges: [{ startLine: 1, endLine: 4 }],
      truncated: false,
    });
    expect(result).not.toHaveProperty("nextOffset");
  });

  it("reads raw ranges verbatim", async () => {
    const result = await bothWays(numbered(12), "raw:4-5,7-8");
    expect(result).toMatchObject({
      representation: "raw",
      content: "line 4\nline 5\nline 7\nline 8\n",
      shownRanges: [
        { startLine: 4, endLine: 5 },
        { startLine: 7, endLine: 8 },
      ],
    });
  });

  it("resolves a tail member against the file's line count", async () => {
    const result = await bothWays(numbered(30), "5-10,-3");
    expect(result).toMatchObject({
      requestedRanges: [
        { startLine: 5, endLine: 10 },
        { startLine: 28, endLine: 30 },
      ],
      shownRanges: [
        { startLine: 4, endLine: 11 },
        { startLine: 27, endLine: 30 },
      ],
      truncated: false,
    });
  });

  it("resolves an open-ended member against the file's line count", async () => {
    const result = await bothWays(numbered(12), "5-,8-10");
    expect(result).toMatchObject({
      requestedRanges: [{ startLine: 5, endLine: 12 }],
      shownRanges: [{ startLine: 4, endLine: 12 }],
    });
  });

  it("reads both raw orders as one request", async () => {
    const canonical = await bothWays(numbered(40), "raw:1-5,-20");
    expect(canonical).toMatchObject({
      representation: "raw",
      content: `${Array.from({ length: 5 }, (_, i) => `line ${i + 1}\n`).join("")}${Array.from(
        { length: 20 },
        (_, i) => `line ${i + 21}\n`,
      ).join("")}`,
      requestedRanges: [
        { startLine: 1, endLine: 5 },
        { startLine: 21, endLine: 40 },
      ],
      shownRanges: [
        { startLine: 1, endLine: 5 },
        { startLine: 21, endLine: 40 },
      ],
    });
    expect(await bothWays(numbered(40), "1-5,-20:raw")).toEqual(canonical);
  });

  it("counts a file before an outline scope asks for its tail", async () => {
    const outlinePath = join(directory, "source.md");
    await writeFile(
      outlinePath,
      `# Title\nintro\n## Setup\nbody\n${"tail\n".repeat(196)}`,
    );
    const scoped = await readFile({ path: `${outlinePath}:outline:-200` });
    expect(scoped).toMatchObject({
      representation: "outline",
      requestedRange: { startLine: 1, endLine: 200 },
    });
    expect(scoped).toHaveProperty(
      "content",
      expect.stringContaining("3: ## Setup"),
    );
    expect(await readFile({ path: `${outlinePath}:outline:1-200` })).toEqual(
      scoped,
    );
  });

  it("skips an oversized line and reports the hole as truncation", async () => {
    const source = `line 1\n${"z".repeat(20_000)}\nline 3\nline 4\nline 5\n`;
    const result = await bothWays(source, "1-2,4-5");
    expect(result).toMatchObject({
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 5 },
      ],
      truncated: true,
    });
    expect(result.content).toBe("1: line 1\n3: line 3\n4: line 4\n5: line 5\n");
  });

  it("rolls a later range back whole when the shared budget cannot hold it", async () => {
    const result = await bothWays(wide(60), "1-15,20-35");
    expect(result).toMatchObject({
      shownRanges: [{ startLine: 1, endLine: 16 }],
      truncated: true,
      nextOffset: 18,
    });
  });

  it("withholds reserved envelope room from the shared cap", async () => {
    const source = wide(30);
    const selector = "1-5,20-24";
    await writeFile(path, source);
    const reserved = asMulti(
      await readResolvedFile(path, {
        displayPath: path,
        selector,
        reserveCodeUnits: 12_000,
      }),
    );
    expect(
      selectMultiRangeLines(source, {
        ...applySelectorSuffix(path, selector),
        reserveCodeUnits: 12_000,
      }),
    ).toEqual(reserved);
    expect(reserved.truncated).toBe(true);
    expect(
      selectMultiRangeLines(source, applySelectorSuffix(path, selector)),
    ).toMatchObject({ truncated: false });
  });

  it("fails a request whose first start exceeds EOF", async () => {
    await writeFile(path, numbered(12));
    expect(() =>
      selectMultiRangeLines(
        numbered(12),
        applySelectorSuffix(path, "99-100,200-201"),
      ),
    ).toThrowError(NativeFileError);
  });

  it("refuses a single-range target", () => {
    expect(() =>
      selectMultiRangeLines(numbered(12), applySelectorSuffix(path, "4-5")),
    ).toThrowError(NativeFileError);
  });
});

describe("markdown ancestor range selection", () => {
  function markdownSource(): string {
    const lines = Array.from({ length: 73 }, (_, index) => `body ${index + 1}`);
    lines[12] = "# Level one";
    lines[31] = "## Level two";
    lines[53] = "### Level three";
    lines[58] = "context";
    return `${lines.join("\n")}\n`;
  }

  it("prepends the root heading chain and promotes a single range", () => {
    const target = applySelectorSuffix("/doc.md", "60-72");
    const result = selectSourceLines(markdownSource(), target, "text/markdown");
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content:
        "13: # Level one\n" +
        "32: ## Level two\n" +
        "54: ### Level three\n" +
        "59: context\n" +
        "60: body 60\n" +
        "61: body 61\n" +
        "62: body 62\n" +
        "63: body 63\n" +
        "64: body 64\n" +
        "65: body 65\n" +
        "66: body 66\n" +
        "67: body 67\n" +
        "68: body 68\n" +
        "69: body 69\n" +
        "70: body 70\n" +
        "71: body 71\n" +
        "72: body 72\n" +
        "73: body 73\n",
      requestedRanges: [{ startLine: 60, endLine: 72 }],
      shownRanges: [
        { startLine: 13, endLine: 13 },
        { startLine: 32, endLine: 32 },
        { startLine: 54, endLine: 54 },
        { startLine: 59, endLine: 73 },
      ],
      nextOffset: 72,
      truncated: false,
    });
  });

  it("uses the requested line instead of a previous-section context line", () => {
    const source = "# Root\nbody\n## A\n## B\nselected\n";
    const result = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "5-5"),
      "text/markdown",
    );
    expect(result.content).toBe("1: # Root\n4: ## B\n5: selected\n");
  });
  it("does not repeat a heading window start and merges an ancestor at N-2", () => {
    const source =
      ["preface", "preamble", "# Root", "context", "## Child", "after"].join(
        "\n",
      ) + "\n";
    const result = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "5-5"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "3: # Root\n4: context\n5: ## Child\n6: after\n",
      requestedRanges: [{ startLine: 5, endLine: 5 }],
      shownRanges: [{ startLine: 3, endLine: 6 }],
      nextOffset: 5,
      truncated: false,
    });
  });

  it("keeps every line of a setext ancestor", () => {
    const source = "# Root\n\nTitle\nsubtitle\n===\nbody\nnext\n";
    const result = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "6-6"),
      "text/markdown",
    );
    expect(result.content).toBe(
      "3: Title\n4: subtitle\n5: ===\n6: body\n7: next\n",
    );
    expect(result).toMatchObject({
      shownRanges: [{ startLine: 3, endLine: 7 }],
    });
  });

  it("promotes a setext paragraph whose underline is inside the window", () => {
    const result = selectSourceLines(
      "Title\nsubtitle\n===\nselected\nafter\n",
      applySelectorSuffix("/doc.md", "4-4"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "1: Title\n2: subtitle\n3: ===\n4: selected\n5: after\n",
      requestedRanges: [{ startLine: 4, endLine: 4 }],
      shownRanges: [{ startLine: 1, endLine: 5 }],
      nextOffset: 4,
      truncated: false,
    });
  });

  it("does not look past the Markdown window for setext resolution", () => {
    const source = "Title\nsubtitle\nextra\n===\nbody\n";
    const truncatedSource = "Title\nsubtitle\nextra\n";
    const target = applySelectorSuffix("/doc.md", "2-2");
    const result = selectSourceLines(source, target, "text/markdown");
    expect(result).toEqual(
      selectSourceLines(truncatedSource, target, "text/markdown"),
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "1: Title\n2: subtitle\n3: extra\n",
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 1, endLine: 3 },
      nextOffset: 2,
      truncated: false,
    });
  });

  it("replays an unclosed line-one delimiter as Markdown", () => {
    const result = selectSourceLines(
      "---\n# x\ncontext\nselected\nafter\n---\n",
      applySelectorSuffix("/doc.md", "4-4"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "2: # x\n3: context\n4: selected\n5: after\n",
      requestedRanges: [{ startLine: 4, endLine: 4 }],
      shownRanges: [{ startLine: 2, endLine: 5 }],
      nextOffset: 4,
      truncated: false,
    });
  });

  it("recalculates the ancestor chain on a continuation", () => {
    const source =
      Array.from({ length: 2502 }, (_, index) =>
        index === 0 ? "# Root" : "",
      ).join("\n") + "\n";
    const first = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "3-2502"),
      "text/markdown",
    );
    expect(first).toMatchObject({ truncated: true, nextOffset: 2000 });
    if (first.status !== "success" || first.nextOffset === undefined)
      throw new Error("Expected a continuation offset");
    const continuation = selectSourceLines(
      source,
      applySelectorSuffix(
        "/doc.md",
        `${first.nextOffset + 1}-${first.nextOffset + 1}`,
      ),
      "text/markdown",
    );
    expect(continuation).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "1: # Root\n2000: \n2001: \n2002: \n",
      requestedRanges: [{ startLine: 2001, endLine: 2001 }],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 2000, endLine: 2002 },
      ],
      nextOffset: 2001,
      truncated: false,
    });
  });

  it("keeps a singular window when even the deepest heading does not fit", () => {
    const result = selectSourceLines(
      `# ${"a".repeat(120)}\n## ${"b".repeat(120)}\n### ${"c".repeat(120)}\ncontext\nselected\n`,
      {
        ...applySelectorSuffix("/doc.md", "5-5"),
        reserveCodeUnits: 15_700,
      },
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "4: context\n5: selected\n",
      requestedRange: { startLine: 5, endLine: 5 },
      shownRange: { startLine: 4, endLine: 5 },
      truncated: false,
    });
  });

  it("preserves CRLF on ancestor and ordinary rendered lines", () => {
    const result = selectSourceLines(
      "# Root\r\ncontext\r\nselected\r\nafter\r\n",
      applySelectorSuffix("/doc.md", "3-3"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "1: # Root\r\n2: context\r\n3: selected\r\n4: after\r\n",
      requestedRanges: [{ startLine: 3, endLine: 3 }],
      shownRanges: [{ startLine: 1, endLine: 4 }],
      nextOffset: 3,
      truncated: false,
    });
  });

  it("adds each passage chain once in source order", () => {
    const source =
      [
        "# Root",
        "root intro",
        "## First",
        "first body",
        "first tail",
        "",
        "",
        "",
        "",
        "## Second",
        "second body",
        "second tail",
      ].join("\n") + "\n";
    const result = selectMultiRangeLines(
      source,
      applySelectorSuffix("/doc.md", "4-4,11-11"),
      "text/markdown",
    );
    expect(result.content).toBe(
      "1: # Root\n3: ## First\n4: first body\n5: first tail\n" +
        "10: ## Second\n11: second body\n12: second tail\n",
    );
    expect(result.shownRanges).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 5 },
      { startLine: 10, endLine: 12 },
    ]);
  });

  it("matches file-backed and in-memory Markdown selection", async () => {
    const source = markdownSource();
    const directory = await mkdtemp(join(tmpdir(), "native-markdown-"));
    try {
      const markdownPath = join(directory, "source.md");
      await writeFile(markdownPath, source);
      const target = applySelectorSuffix(markdownPath, "60-72");
      const fromFile = await readFile({ path: `${markdownPath}:60-72` });
      const fromMemory = selectSourceLines(source, target, "text/markdown");
      expect(fromFile).toEqual(fromMemory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the singular shape when Markdown has no enclosing heading", () => {
    const result = selectSourceLines(
      "opening\nselected\nclosing\n",
      applySelectorSuffix("/doc.md", "2-2"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "1: opening\n2: selected\n3: closing\n",
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 1, endLine: 3 },
      truncated: false,
      nextOffset: 2,
    });
  });

  it("keeps raw Markdown ranges verbatim", () => {
    const result = selectSourceLines(
      "# Root\nbody\n",
      { ...applySelectorSuffix("/doc.md", "raw:2-2") },
      "text/markdown",
    );
    expect(result).toMatchObject({
      representation: "raw",
      content: "body\n",
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 2, endLine: 2 },
    });
  });

  it("drops outer heading units under a tight result budget", () => {
    const source = "# Title\n## Setup\n### Linux\ncontext\nselected\n";
    const result = selectSourceLines(
      source,
      { ...applySelectorSuffix("/doc.md", "5-5"), reserveCodeUnits: 15_740 },
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "3: ### Linux\n4: context\n5: selected\n",
      requestedRanges: [{ startLine: 5, endLine: 5 }],
      shownRanges: [{ startLine: 3, endLine: 5 }],
      truncated: false,
    });
  });

  it("uses the selected source record for comma ancestors", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `body ${index + 1}`);
    lines[0] = "# Title";
    lines[7] = "## Section";
    const result = selectMultiRangeLines(
      `${lines.join("\n")}\n`,
      applySelectorSuffix("/doc.md", "10-12,30-31"),
      "text/markdown",
    );
    expect(result.content).toBe(
      "1: # Title\n8: ## Section\n9: body 9\n10: body 10\n" +
        "11: body 11\n12: body 12\n13: body 13\n" +
        "29: body 29\n30: body 30\n31: body 31\n32: body 32\n",
    );
  });

  it("keeps comma chain lines in source order", () => {
    const first = [
      "# Top",
      "",
      "Para a",
      "Para b",
      "===",
      "body 6",
      "body 7",
    ].join("\n");
    const second = [
      "# Top",
      "",
      "Para a",
      "Para b",
      "body",
      "body",
      "body",
      "===",
      "after",
    ].join("\n");
    const oversized = [
      "# H",
      "intro",
      "context",
      "x".repeat(16_000),
      "five",
      "six",
      "seven",
      "gap",
      "nine",
      "ten",
    ].join("\n");
    expect(
      selectMultiRangeLines(
        `${first}\n`,
        applySelectorSuffix("/doc.md", "3,7"),
        "text/markdown",
      ).content,
    ).toBe("2: \n3: Para a\n4: Para b\n5: ===\n6: body 6\n7: body 7\n");
    expect(
      selectMultiRangeLines(
        `${second}\n`,
        applySelectorSuffix("/doc.md", "4,9"),
        "text/markdown",
      ).content,
    ).toBe(
      "3: Para a\n4: Para b\n5: body\n6: body\n7: body\n8: ===\n9: after\n",
    );
    expect(
      selectMultiRangeLines(
        `${oversized}\n`,
        applySelectorSuffix("/doc.md", "4-6,10-10"),
        "text/markdown",
      ).content,
    ).toBe("3: context\n5: five\n6: six\n7: seven\n9: nine\n10: ten\n");
  });

  it("does not treat a requested line's own setext heading as its ancestor", () => {
    const source = "# Top\n\nt3\nt4\nt5\n---\nbody\n";
    expect(
      selectSourceLines(
        source,
        applySelectorSuffix("/doc.md", "5-5"),
        "text/markdown",
      ),
    ).toMatchObject({
      content: "1: # Top\n4: t4\n5: t5\n6: ---\n",
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 4, endLine: 6 },
      ],
    });
  });

  it("continues a setext ancestor straddling an earlier passage", () => {
    const source = "# Top\n\nintro\n\nt5\nt6\nt7\n---\ns9\n### Sub\nb11\nb12\n";
    expect(
      selectMultiRangeLines(
        source,
        applySelectorSuffix("/doc.md", "6,12"),
        "text/markdown",
      ).content,
    ).toBe(
      "1: # Top\n5: t5\n6: t6\n7: t7\n8: ---\n10: ### Sub\n11: b11\n12: b12\n",
    );
  });

  it("matches text retention and rollback for large comma ranges", async () => {
    const blank = "\n".repeat(5000);
    const directory = await mkdtemp(join(tmpdir(), "native-retention-"));
    try {
      // Same-length names keep the serialized budgets identical.
      await writeFile(join(directory, "notes.md"), blank);
      await writeFile(join(directory, "note.txt"), blank);
      await writeFile(join(directory, "head.md"), `# H\n${blank.slice(1)}`);
      const cases = [
        ["notes.md", "1-1499,3000-4500", 1500, 2998],
        ["note.txt", "1-1499,3000-4500", 1500, 2998],
        ["notes.md", "1-1000,2000-3000", 1001, 1998],
        ["note.txt", "1-1000,2000-3000", 1001, 1998],
        ["notes.md", "1-2500,4000-4010", 2000, 2000],
        ["note.txt", "1-2500,4000-4010", 2000, 2000],
        ["head.md", "3-2500,4000-4010", 2000, 2000],
      ] as const;
      for (const [name, selector, endLine, nextOffset] of cases) {
        const result = asMulti(
          await readFile({ path: `${join(directory, name)}:${selector}` }),
        );
        expect(result).toMatchObject({
          shownRanges: [{ startLine: 1, endLine }],
          nextOffset,
          truncated: true,
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps byte-budget Markdown and text ranges identical", async () => {
    const source = `${Array.from({ length: 500 }, () => "x".repeat(200)).join(
      "\n",
    )}\n`;
    const directory = await mkdtemp(join(tmpdir(), "native-byte-budget-"));
    try {
      const paths = [join(directory, "same.md"), join(directory, "sam.txt")];
      for (const path of paths) await writeFile(path, source);
      for (const path of paths) {
        const result = asMulti(
          await readFile({ path: `${path}:1-300,400-410` }),
        );
        expect(result.shownRanges).toEqual([{ startLine: 1, endLine: 76 }]);
        expect(result.nextOffset).toBe(76);
        expect(result.truncated).toBe(true);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not truncate a comma read with exactly 2,000 selected lines", () => {
    const source = "\n".repeat(2000);
    const result = selectMultiRangeLines(
      source,
      applySelectorSuffix("/doc.md", "1-999,1001-1999"),
      "text/markdown",
    );
    expect(result.truncated).toBe(false);
    expect(result).not.toHaveProperty("nextOffset");
    expect(result.shownRanges).toEqual([{ startLine: 1, endLine: 2000 }]);
  });

  it("reserves the first requested line in single chain admission", () => {
    const source =
      [
        `# ${"h".repeat(120)}`,
        ...Array.from({ length: 8 }, () => "body"),
        "selected",
      ].join("\n") + "\n";
    const result = selectSourceLines(
      source,
      { ...applySelectorSuffix("/doc.md", "10-10"), reserveCodeUnits: 15_606 },
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content: "9: body\n10: selected\n",
      requestedRange: { startLine: 10, endLine: 10 },
      shownRange: { startLine: 9, endLine: 10 },
      truncated: false,
    });
  });

  it("advances a promoted continuation past a tight ancestor budget", () => {
    const source =
      [
        "# H",
        "b2",
        "b3",
        "a".repeat(8000),
        "c".repeat(7730),
        ...Array.from({ length: 1005 }, () => ""),
      ].join("\n") + "\n";
    const first = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "5-1004"),
      "text/markdown",
    );
    if (first.status !== "success" || first.nextOffset === undefined)
      throw new Error("Expected a continuation offset");
    const continuation = selectSourceLines(
      source,
      applySelectorSuffix(
        "/doc.md",
        `${first.nextOffset + 1}-${first.nextOffset + 1}`,
      ),
      "text/markdown",
    );
    expect(first.nextOffset).toBeGreaterThan(4);
    expect(continuation.content).not.toBe(first.content);
  });

  it("reserves continuation metadata in Markdown result budgets", () => {
    const source =
      [
        "# H",
        "",
        "a".repeat(7000),
        "b".repeat(7000),
        "c".repeat(1765),
        "d",
      ].join("\n") + "\n";
    const single = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "3-100"),
      "text/markdown",
    );
    const multi = selectMultiRangeLines(
      source,
      applySelectorSuffix("/doc.md", "3-5,7-9"),
      "text/markdown",
    );
    expect(measureNativeModelOutput(single)).toBeLessThanOrEqual(16_000);
    expect(measureNativeModelOutput(multi)).toBeLessThanOrEqual(16_000);
  });

  it("keeps oversized host and in-memory Markdown scans identical", async () => {
    const source =
      [
        "# Outer",
        "",
        "Title",
        `${"=".repeat(16_000)}=x`,
        "",
        "body 6",
        "body 7",
        "body 8",
      ].join("\n") + "\n";
    const directory = await mkdtemp(join(tmpdir(), "native-oversized-"));
    try {
      const path = join(directory, "source.md");
      await writeFile(path, source);
      const fromFile = await readFile({ path: `${path}:7-7` });
      const fromMemory = selectSourceLines(
        source,
        applySelectorSuffix(path, "7-7"),
        "text/markdown",
      );
      expect(fromFile).toEqual(fromMemory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("drops only an oversized outer heading unit", () => {
    const source =
      [
        `# ${"a".repeat(16_000)}`,
        "",
        "## Inner",
        "",
        "body 5",
        "body 6",
        "body 7",
      ].join("\n") + "\n";
    const target = applySelectorSuffix("/doc.md", "6-6");
    const result = selectSourceLines(source, target, "text/markdown");
    expect(result.content).toBe(
      "3: ## Inner\n5: body 5\n6: body 6\n7: body 7\n",
    );
    if (!("shownRanges" in result)) throw new Error("Expected plural result");
    expect(result.shownRanges).toEqual([
      { startLine: 3, endLine: 3 },
      { startLine: 5, endLine: 7 },
    ]);
  });

  /** The issue's file shape: one root heading, one section heading, and a
   *  two-column table whose body rows run from line 128 to line 140. */
  function tableDocument(): string {
    const lines = Array.from(
      { length: 140 },
      (_, index) => `body ${index + 1}`,
    );
    lines[5] = "# Iterative Review Refinement";
    lines[123] = "## Common Rationalizations";
    lines[125] = "| Rationalization | Correction |";
    lines[126] = "| --- | --- |";
    for (let index = 127; index < lines.length; index += 1)
      lines[index] = `| row ${index + 1} | cell ${index + 1} |`;
    return `${lines.join("\n")}\n`;
  }

  it("prepends the header pair of a table the range starts inside", () => {
    const result = selectSourceLines(
      tableDocument(),
      applySelectorSuffix("/doc.md", "129-130"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content:
        "6: # Iterative Review Refinement\n" +
        "124: ## Common Rationalizations\n" +
        "126: | Rationalization | Correction |\n" +
        "127: | --- | --- |\n" +
        "128: | row 128 | cell 128 |\n" +
        "129: | row 129 | cell 129 |\n" +
        "130: | row 130 | cell 130 |\n" +
        "131: | row 131 | cell 131 |\n",
      requestedRanges: [{ startLine: 129, endLine: 130 }],
      shownRanges: [
        { startLine: 6, endLine: 6 },
        { startLine: 124, endLine: 124 },
        { startLine: 126, endLine: 131 },
      ],
      nextOffset: 130,
      truncated: false,
    });
  });

  it("prepends only the header row when the delimiter row is the context line", () => {
    const result = selectSourceLines(
      tableDocument(),
      applySelectorSuffix("/doc.md", "128-128"),
      "text/markdown",
    );
    expect(result).toEqual({
      status: "success",
      kind: "file",
      path: "/doc.md",
      representation: "text",
      content:
        "6: # Iterative Review Refinement\n" +
        "124: ## Common Rationalizations\n" +
        "126: | Rationalization | Correction |\n" +
        "127: | --- | --- |\n" +
        "128: | row 128 | cell 128 |\n" +
        "129: | row 129 | cell 129 |\n",
      requestedRanges: [{ startLine: 128, endLine: 128 }],
      shownRanges: [
        { startLine: 6, endLine: 6 },
        { startLine: 124, endLine: 124 },
        { startLine: 126, endLine: 129 },
      ],
      nextOffset: 128,
      truncated: false,
    });
  });

  it("emits no header pair when the range starts on the header or delimiter row", () => {
    const expected = {
      // Outside the table: the section context line, no header pair.
      "123-123":
        "6: # Iterative Review Refinement\n" +
        "122: body 122\n" +
        "123: body 123\n" +
        "124: ## Common Rationalizations\n",
      "125-125":
        "6: # Iterative Review Refinement\n" +
        "124: ## Common Rationalizations\n" +
        "125: body 125\n" +
        "126: | Rationalization | Correction |\n",
      // The header row is the requested line, so it is window content only.
      "126-126":
        "6: # Iterative Review Refinement\n" +
        "124: ## Common Rationalizations\n" +
        "125: body 125\n" +
        "126: | Rationalization | Correction |\n" +
        "127: | --- | --- |\n",
      // The delimiter row is the requested line, so it selects no pair.
      "127-127":
        "6: # Iterative Review Refinement\n" +
        "124: ## Common Rationalizations\n" +
        "126: | Rationalization | Correction |\n" +
        "127: | --- | --- |\n" +
        "128: | row 128 | cell 128 |\n",
    };
    for (const [requested, content] of Object.entries(expected)) {
      const result = selectSourceLines(
        tableDocument(),
        applySelectorSuffix("/doc.md", requested),
        "text/markdown",
      );
      expect({ requested, content: result.content }).toEqual({
        requested,
        content,
      });
    }
  });

  it("keeps the header pair when the outer headings do not fit", () => {
    const rows = Array.from(
      { length: 40 },
      (_, index) => `| row ${index + 1} ${"r".repeat(2985)} | b |`,
    );
    rows[0] = `# ${"t".repeat(4000)}`;
    rows[1] = `## ${"s".repeat(4000)}`;
    rows[2] = `| ${"h".repeat(3390)} | b |`;
    rows[3] = `| --- | ${"-".repeat(3390)} |`;
    const result = selectSourceLines(
      `${rows.join("\n")}\n`,
      applySelectorSuffix("/doc.md", "8-9"),
      "text/markdown",
    );
    // Both ancestors drop; the pair is the last unit standing.
    expect(result.content).toBe(
      `3: ${rows[2]}\n4: ${rows[3]}\n7: ${rows[6]}\n8: ${rows[7]}\n`,
    );
    expect(result.truncated).toBe(true);
    if (!("shownRanges" in result)) throw new Error("Expected plural result");
    expect(result.shownRanges).toEqual([
      { startLine: 3, endLine: 4 },
      { startLine: 7, endLine: 8 },
    ]);
  });

  it("emits a shared header pair once for two passages in one table", () => {
    const result = selectMultiRangeLines(
      tableDocument(),
      applySelectorSuffix("/doc.md", "129-129,131-131"),
      "text/markdown",
    );
    expect(result.content).toBe(
      "6: # Iterative Review Refinement\n" +
        "124: ## Common Rationalizations\n" +
        "126: | Rationalization | Correction |\n" +
        "127: | --- | --- |\n" +
        "128: | row 128 | cell 128 |\n" +
        "129: | row 129 | cell 129 |\n" +
        "130: | row 130 | cell 130 |\n" +
        "131: | row 131 | cell 131 |\n" +
        "132: | row 132 | cell 132 |\n",
    );
    expect(result.requestedRanges).toEqual([
      { startLine: 129, endLine: 129 },
      { startLine: 131, endLine: 131 },
    ]);
    expect(result.shownRanges).toEqual([
      { startLine: 6, endLine: 6 },
      { startLine: 124, endLine: 124 },
      { startLine: 126, endLine: 132 },
    ]);
  });

  it("emits only an unshown header line a later passage still needs", () => {
    const result = selectMultiRangeLines(
      tableDocument(),
      applySelectorSuffix("/doc.md", "124-125,129-129"),
      "text/markdown",
    );
    // The first passage's window reaches the header row, so the later passage's
    // pair contributes the delimiter row 127 alone.
    expect(result.content).toBe(
      "6: # Iterative Review Refinement\n" +
        "123: body 123\n" +
        "124: ## Common Rationalizations\n" +
        "125: body 125\n" +
        "126: | Rationalization | Correction |\n" +
        "127: | --- | --- |\n" +
        "128: | row 128 | cell 128 |\n" +
        "129: | row 129 | cell 129 |\n" +
        "130: | row 130 | cell 130 |\n",
    );
    expect(result.shownRanges).toEqual([
      { startLine: 6, endLine: 6 },
      { startLine: 123, endLine: 130 },
    ]);
  });

  it("emits each table's own header pair for passages in two tables", () => {
    const source =
      [
        "# Root",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "| 3 | 4 |",
        "",
        "## Second",
        "| c | d |",
        "| --- | --- |",
        "| 5 | 6 |",
        "| 7 | 8 |",
      ].join("\n") + "\n";
    const result = selectMultiRangeLines(
      source,
      applySelectorSuffix("/doc.md", "4-4,10-10"),
      "text/markdown",
    );
    expect(result.content).toBe(
      "1: # Root\n" +
        "2: | a | b |\n" +
        "3: | --- | --- |\n" +
        "4: | 1 | 2 |\n" +
        "5: | 3 | 4 |\n" +
        "7: ## Second\n" +
        "8: | c | d |\n" +
        "9: | --- | --- |\n" +
        "10: | 5 | 6 |\n" +
        "11: | 7 | 8 |\n",
    );
    expect(result.shownRanges).toEqual([
      { startLine: 1, endLine: 5 },
      { startLine: 7, endLine: 11 },
    ]);
  });

  it("recalculates the header pair at a continuation inside a table", () => {
    const source =
      [
        "# Root",
        "| a | b |",
        "| --- | --- |",
        ...Array.from(
          { length: 30 },
          (_, index) => `| row ${index + 1} ${"x".repeat(700)} | b |`,
        ),
      ].join("\n") + "\n";
    const first = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "4-30"),
      "text/markdown",
    );
    expect(first.truncated).toBe(true);
    if (first.nextOffset === undefined)
      throw new Error("Expected a continuation offset");
    const retry = selectSourceLines(
      source,
      applySelectorSuffix(
        "/doc.md",
        `${first.nextOffset + 1}-${first.nextOffset + 2}`,
      ),
      "text/markdown",
    );
    expect(retry.content).toContain("2: | a | b |\n3: | --- | --- |\n");
  });

  it("shows a later table's header rows once when the window ends on them", () => {
    const source =
      [
        "# Root",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "| 3 | 4 |",
        "| c | d |",
        "| --- | --- |",
        "| 5 | 6 |",
        "| 7 | 8 |",
      ].join("\n") + "\n";
    const result = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "4-6"),
      "text/markdown",
    );
    expect(result.content).toBe(
      "1: # Root\n" +
        "2: | a | b |\n" +
        "3: | --- | --- |\n" +
        "4: | 1 | 2 |\n" +
        "5: | 3 | 4 |\n" +
        "6: | c | d |\n" +
        "7: | --- | --- |\n",
    );
  });

  it("resolves a setext underline only inside the window", () => {
    const source = "# Root\n\na | b\n-|-\n1|2\n===\n";
    const full = selectSourceLines(
      source,
      applySelectorSuffix("/doc.md", "5-5"),
      "text/markdown",
    );
    // The underline turns the table's lines into heading text, and line 5 is
    // inside that heading, so it is neither an ancestor nor a body row.
    expect(full).toMatchObject({
      content: "4: -|-\n5: 1|2\n6: ===\n",
      requestedRange: { startLine: 5, endLine: 5 },
      shownRange: { startLine: 4, endLine: 6 },
    });
    const truncated = selectSourceLines(
      "# Root\n\na | b\n-|-\n1|2\n",
      applySelectorSuffix("/doc.md", "5-5"),
      "text/markdown",
    );
    // Past the window end there is no underline, so the lines stay a table.
    expect(truncated.content).toBe("1: # Root\n3: a | b\n4: -|-\n5: 1|2\n");
  });
});
