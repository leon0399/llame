import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NativeFileError, applySelectorSuffix } from "./path";
import { readFile, readResolvedFile } from "./read";
import type {
  DirectoryFailure,
  DirectorySuccess,
  FileFailure,
  MultiReadSuccess,
  ReadSuccess,
} from "./read";
import { selectMultiRangeLines } from "./stream-read";
import { selectSourceLines } from "./source-lines";

/** What a native read reports, before the guard below narrows it. */
type ReadOutcome =
  | ReadSuccess
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
      applySelectorSuffix(path, selector),
    );
    expect(fromMemory).toEqual(fromFile);
    return fromMemory;
  }

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

  it("keeps non-Markdown selection byte-compatible", () => {
    const target = applySelectorSuffix("/doc.txt", "3-3");
    const result = selectSourceLines("# Heading\nbody\nvalue\n", target);
    expect(result).toMatchObject({
      content: "2: body\n3: value\n",
      requestedRange: { startLine: 3, endLine: 3 },
      shownRange: { startLine: 2, endLine: 3 },
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
    const source = "# Title\n## Setup\n### Linux\nselected\n";
    const result = selectSourceLines(
      source,
      { ...applySelectorSuffix("/doc.md", "4-4"), reserveCodeUnits: 15_760 },
      "text/markdown",
    );
    expect(result.content).toContain("3: ### Linux\n");
    expect(result.content).toContain("4: selected\n");
    expect(result.content).not.toContain("1: # Title\n");
    expect(result.content).not.toContain("2: ## Setup\n");
  });
});
