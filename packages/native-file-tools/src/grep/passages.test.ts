import { grepFilePassages } from "./passages";
import { compileGrepPatterns } from "./patterns";
import type { CompiledGrepPatterns } from "./patterns";

function patterns(
  sources: ReadonlyArray<string>,
  ignoreCase = false,
): CompiledGrepPatterns {
  const compiled = compileGrepPatterns({
    patterns: sources,
    literal: false,
    ignoreCase,
  });
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.compiled;
}

function numbered(count: number, content: (line: number) => string): string {
  return Array.from({ length: count }, (_, index) => content(index + 1)).join(
    "\n",
  );
}

describe("grep passage extraction", () => {
  it("merges touching windows into one passage", async () => {
    const text = "a\nb\nc\nhit\ne\nhit\ng\nh\ni\nj\n";
    const passages = await grepFilePassages("file.md", text, patterns(["hit"]));
    expect(passages).toEqual([
      {
        locator: "file.md:3-7",
        content: "3: c\n4: hit\n5: e\n6: hit\n7: g",
        matches: [4, 6],
      },
    ]);
  });

  it("clips a window at the file start", async () => {
    const passages = await grepFilePassages(
      "file.md",
      numbered(10, (line) => (line === 1 ? "hit" : `line ${line}`)),
      patterns(["hit"]),
    );
    expect(passages[0]).toMatchObject({ locator: "file.md:1-2", matches: [1] });
  });

  it("clips a window at the file end", async () => {
    const passages = await grepFilePassages(
      "file.md",
      numbered(10, (line) => (line === 10 ? "hit" : `line ${line}`)),
      patterns(["hit"]),
    );
    expect(passages[0]).toMatchObject({
      locator: "file.md:9-10",
      matches: [10],
    });
  });

  it("cuts a long line at 512 code units", async () => {
    const long = `${"x".repeat(897)}hit`;
    const passages = await grepFilePassages(
      "file.md",
      `${long}\n`,
      patterns(["hit"]),
    );
    const line = passages[0].content.split("\n")[0];
    expect(line).toBe(`1: ${"x".repeat(512)}…`);
  });

  it("partitions a long merged interval after its last matched line", async () => {
    const passages = await grepFilePassages(
      "file.md",
      numbered(4500, () => "x"),
      patterns(["x"]),
    );
    expect(passages.map((passage) => passage.locator)).toEqual([
      "file.md:1-2000",
      "file.md:2001-4000",
      "file.md:4001-4500",
    ]);
    expect(passages.map((passage) => passage.matches.length)).toEqual([
      2000, 2000, 500,
    ]);
  });

  it("drops a trailing context-only remainder", async () => {
    const text = numbered(2001, (line) => (line === 2001 ? "context" : "hit"));
    const passages = await grepFilePassages("file.md", text, patterns(["hit"]));
    expect(passages.map((passage) => passage.locator)).toEqual([
      "file.md:1-2000",
    ]);
  });

  it("ignores case on request", async () => {
    const passages = await grepFilePassages(
      "file.md",
      "a\nTODO\nb\n",
      patterns(["todo"], true),
    );
    expect(passages[0]).toMatchObject({ locator: "file.md:1-3", matches: [2] });
  });

  it("keeps CRLF as one delimiter and lone CR as text", async () => {
    const passages = await grepFilePassages(
      "file.md",
      "a\r\nhit\r\nb\rc\r\n",
      patterns(["hit"]),
    );
    expect(passages[0]).toEqual({
      locator: "file.md:1-3",
      content: "1: a\n2: hit\n3: b\rc",
      matches: [2],
    });
  });

  it("makes no phantom line from a terminal delimiter", async () => {
    const passages = await grepFilePassages(
      "file.md",
      "hit\n",
      patterns(["hit"]),
    );
    expect(passages.map((passage) => passage.locator)).toEqual(["file.md:1-1"]);
    expect(passages[0].content).toBe("1: hit");
  });

  it("returns nothing when no line matches", async () => {
    expect(
      await grepFilePassages("file.md", "a\nb\n", patterns(["zzz"])),
    ).toEqual([]);
  });
});
