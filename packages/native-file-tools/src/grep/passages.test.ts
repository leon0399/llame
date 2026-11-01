import {
  scanGrepFile,
  type GrepFileResume,
  type GrepFileScan,
} from "./passages";
import { compileGrepPatterns } from "./patterns";
import type { CompiledGrepPatterns } from "./patterns";
import type { GrepPassage, GrepReadRefusal } from "./types";
import { chunkBytes, chunkSequence } from "./memory-port.test-fixture";

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

/** One file's text as the byte chunks a port hands over, in `size` pieces. */
function chunked(
  content: string,
  size?: number,
): AsyncIterable<Uint8Array | GrepReadRefusal> {
  const bytes = Buffer.from(content, "utf8");
  return chunkSequence(chunkBytes(bytes, size ?? bytes.byteLength));
}

interface ScanOptions {
  readonly chunkBytes?: number;
  readonly resume?: GrepFileResume;
  readonly maxFileBytes?: number;
}

/** Search one in-memory file's text under the scan's own defaults. */
function scan(
  content: string,
  sources: ReadonlyArray<string>,
  options: ScanOptions = {},
): Promise<GrepFileScan> {
  return scanGrepFile({
    fileLocator: "file.md",
    chunks: chunked(content, options.chunkBytes),
    patterns: patterns(sources),
    maxFileBytes: options.maxFileBytes ?? null,
    ...(options.resume !== undefined && { resume: options.resume }),
  });
}

/** The passages of a successful scan, for compact assertions. */
function passagesOf(result: GrepFileScan): ReadonlyArray<GrepPassage> {
  if (result.kind !== "passages") throw new Error("the file was refused");
  return result.passages;
}

/** The passage locators of a successful scan, for compact assertions. */
function locatorsOf(result: GrepFileScan): ReadonlyArray<string> {
  return passagesOf(result).map((passage) => passage.locator);
}

describe("grep passage extraction", () => {
  it("merges touching windows into one passage", async () => {
    const text = "a\nb\nc\nhit\ne\nhit\ng\nh\ni\nj\n";
    const result = await scan(text, ["hit"]);
    expect(result).toEqual({
      kind: "passages",
      passages: [
        {
          locator: "file.md:3-7",
          content: "3: c\n4: hit\n5: e\n6: hit\n7: g",
          matches: [4, 6],
        },
      ],
      cappedAt: undefined,
      bytes: Buffer.byteLength(text),
      holdStopped: false,
    });
  });

  it("clips a window at the file start", async () => {
    const result = await scan(
      numbered(10, (line) => (line === 1 ? "hit" : `line ${line}`)),
      ["hit"],
    );
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0]).toMatchObject({
      locator: "file.md:1-2",
      matches: [1],
    });
  });

  it("clips a window at the file end", async () => {
    const result = await scan(
      numbered(10, (line) => (line === 10 ? "hit" : `line ${line}`)),
      ["hit"],
    );
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0]).toMatchObject({
      locator: "file.md:9-10",
      matches: [10],
    });
  });

  it("cuts a long line at 512 code units", async () => {
    const long = `${"x".repeat(897)}hit`;
    const result = await scan(`${long}\n`, ["hit"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    const line = result.passages[0].content.split("\n")[0];
    expect(line).toBe(`1: ${"x".repeat(512)}…`);
  });

  it("partitions a long merged interval after its last matched line", async () => {
    const result = await scan(
      numbered(4500, () => "h"),
      ["^h$"],
    );
    expect(locatorsOf(result)).toEqual([
      "file.md:1-2000",
      "file.md:2001-4000",
      "file.md:4001-4500",
    ]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages.map((passage) => passage.matches.length)).toEqual([
      2000, 2000, 500,
    ]);
  });

  it("drops a trailing context-only remainder", async () => {
    const text = numbered(2001, (line) => (line === 2001 ? "context" : "h"));
    expect(locatorsOf(await scan(text, ["^h$"]))).toEqual(["file.md:1-2000"]);
  });

  it("ignores case on request", async () => {
    const compiled = compileGrepPatterns({
      patterns: ["todo"],
      literal: false,
      ignoreCase: true,
    });
    if (!compiled.ok) throw new Error(compiled.message);
    const result = await scanGrepFile({
      fileLocator: "file.md",
      chunks: chunked("a\nTODO\nb\n"),
      patterns: compiled.compiled,
      maxFileBytes: null,
    });
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0]).toMatchObject({
      locator: "file.md:1-3",
      matches: [2],
    });
  });

  it("keeps CRLF as one delimiter and lone CR as text", async () => {
    const result = await scan("a\r\nhit\r\nb\rc\r\n", ["hit"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0]).toEqual({
      locator: "file.md:1-3",
      content: "1: a\n2: hit\n3: b\rc",
      matches: [2],
    });
  });

  it("keeps a CRLF pair split across chunks as one delimiter", async () => {
    const result = await scan("a\r\nhit\r\nb\n", ["hit"], { chunkBytes: 1 });
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0]).toEqual({
      locator: "file.md:1-3",
      content: "1: a\n2: hit\n3: b",
      matches: [2],
    });
  });

  it("makes no phantom line from a terminal delimiter", async () => {
    const result = await scan("hit\n", ["hit"], { chunkBytes: 2 });
    expect(locatorsOf(result)).toEqual(["file.md:1-1"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0].content).toBe("1: hit");
  });

  it("returns nothing when no line matches", async () => {
    expect(locatorsOf(await scan("a\nb\n", ["zzz"]))).toEqual([]);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const result = await scan("näïl\n😀 hit\n", ["hit"], { chunkBytes: 1 });
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0]).toMatchObject({
      locator: "file.md:1-2",
      matches: [2],
    });
  });

  it("keeps a byte-order mark as content", async () => {
    const result = await scan("\uFEFFhit\n", ["^hit"], {});
    // The BOM is text under `ignoreBOM`, so an anchored pattern does not match.
    expect(locatorsOf(result)).toEqual([]);
  });

  it("searches a log whose last line matches, read in chunks", async () => {
    const filler = "plain log line\n".repeat(64 * 1024);
    const text = `${filler}needle at the end\n`;
    const result = await scan(text, ["needle"], { chunkBytes: 64 * 1024 });
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0].matches).toEqual([65_537]);
    expect(result.bytes).toBe(Buffer.byteLength(text));
  });

  it("refuses a file with a line longer than 4 MiB", async () => {
    const text = `hit\n${"x".repeat(5 * 1024 * 1024)}\n`;
    const result = await scan(text, ["hit"], { chunkBytes: 64 * 1024 });
    expect(result).toMatchObject({ kind: "refused", refusal: "oversized" });
  });

  it("searches a line exactly at the 4 MiB bound", async () => {
    const line = `${"x".repeat(4 * 1024 * 1024 - 3)}hit`;
    const result = await scan(`${line}\n`, ["hit"], { chunkBytes: 64 * 1024 });
    expect(locatorsOf(result)).toEqual(["file.md:1-1"]);
  });

  it("drops the file when a late byte is not valid UTF-8", async () => {
    const head = Buffer.from("hit\n", "utf8");
    const bytes = Buffer.concat([
      head,
      Buffer.from("y".repeat(200_000), "utf8"),
      Buffer.from([0xff, 0x0a]),
    ]);
    const result = await scanGrepFile({
      fileLocator: "file.md",
      chunks: chunkSequence(chunkBytes(bytes, 64 * 1024)),
      patterns: patterns(["hit"]),
      maxFileBytes: null,
    });
    expect(result).toMatchObject({ kind: "refused", refusal: "invalid_utf8" });
  });

  it("drops the passages of a late over-long line read in later chunks", async () => {
    const text = `hit\n${"x\n".repeat(100)}${"x".repeat(4 * 1024 * 1024 + 1)}\n`;
    const result = await scan(text, ["hit"], { chunkBytes: 64 * 1024 });
    expect(result).toMatchObject({ kind: "refused", refusal: "oversized" });
  });

  it("refuses a file that grows past the streamed byte bound", async () => {
    const result = await scan("0123456789a\n", ["0"], { maxFileBytes: 10 });
    expect(result).toMatchObject({ kind: "refused", refusal: "oversized" });
  });

  it("keeps matching after a complete passage frees the hold limit", async () => {
    // The lookahead line trips the limit, but the passage ends before it, so
    // the scan must keep going and find the hit on line 35.
    const line = (n: number) =>
      `${n <= 28 || n === 35 ? "hit" : "filler"} ${"x".repeat(493)}`;
    const content = `${Array.from({ length: 35 }, (_v, index) => line(index + 1)).join("\n")}\n`;
    const result = await scan(content, ["hit"]);
    expect(locatorsOf(result)).toEqual(["file.md:1-29", "file.md:34-35"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.holdStopped).toBe(false);
  });

  it("marks a passage the hold limit stops as incomplete", async () => {
    const text = numbered(40, () => `hit ${"x".repeat(500)}`);
    const result = await scan(text, ["hit"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages).toHaveLength(1);
    const [passage] = result.passages;
    expect(passage.incomplete).toBe(true);
    const [start, end] = passage.locator
      .split(":")[1]
      .split("-")
      .map((value) => Number(value));
    expect(start).toBe(1);
    expect(end).toBeLessThan(40);
    expect(passage.content.split("\n")).toHaveLength(end - start + 1);
    expect(passage.matches).toHaveLength(end);
    expect(result.holdStopped).toBe(true);
  });

  it("keeps a later match after a gap no window can merge across", async () => {
    const filler = `${"x".repeat(1000)}\n`.repeat(400);
    const result = await scan(`needle one\n${filler}needle two\n`, ["needle"]);
    expect(locatorsOf(result)).toEqual(["file.md:1-2", "file.md:401-402"]);
  });

  it("merges a window whose gap is one line", async () => {
    const result = await scan("needle a\nl2\nl3\nneedle b\nl5\n", ["needle"]);
    expect(locatorsOf(result)).toEqual(["file.md:1-5"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages[0].matches).toEqual([1, 4]);
  });

  it("counts UTF-8 bytes, not code units, against the line bound", async () => {
    const exact = "é".repeat(2 * 1024 * 1024);
    expect(
      locatorsOf(await scan(`${exact}\n`, ["é"], { chunkBytes: 64 * 1024 })),
    ).toEqual(["file.md:1-1"]);
    const over = "é".repeat(2 * 1024 * 1024 + 1);
    expect(
      await scan(`${over}\n`, ["é"], { chunkBytes: 64 * 1024 }),
    ).toMatchObject({ kind: "refused", refusal: "oversized" });
  });

  it("keeps the CR of a CRLF delimiter out of the line bound", async () => {
    const line = `${"x".repeat(4 * 1024 * 1024 - 3)}hit`;
    const result = await scan(`${line}\r\n`, ["hit"], {
      chunkBytes: 64 * 1024,
    });
    expect(locatorsOf(result)).toEqual(["file.md:1-1"]);
  });

  it("probes every chunk of the first 8 KiB for a NUL", async () => {
    const content = `${"x".repeat(5000)}\u0000\n`;
    const result = await scan(content, ["hit"], { chunkBytes: 1024 });
    expect(result).toMatchObject({ kind: "refused", refusal: "binary" });
  });

  it("searches past a NUL after the first 8 KiB", async () => {
    const content = `${"hit\n"}${"x".repeat(9000)}\u0000\n`;
    expect(locatorsOf(await scan(content, ["hit"]))).toEqual(["file.md:1-2"]);
    expect(
      locatorsOf(await scan(content, ["hit"], { chunkBytes: 1024 })),
    ).toEqual(["file.md:1-2"]);
  });

  it("marks the twentieth passage and reports where it is", async () => {
    const text = numbered(84, (line) => (line % 4 === 1 ? "hit" : "line"));
    const result = await scan(text, ["hit"]);
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages).toHaveLength(20);
    expect(result.passages[19].truncated).toBe(true);
    // Hits every fourth line give 21 windows; the twentieth spans 76-78.
    expect(result.cappedAt).toBe(76);
  });
});

/** Groups of six lines whose first and third match, so a passage holds two. */
function groupedPassages(count: number): string {
  const lines: Array<string> = [];
  for (let group = 0; group < count; group += 1) {
    lines.push("hit", "filler", "hit", "filler", "filler", "filler");
  }
  return numbered(lines.length, (line) => lines[line - 1]);
}

describe("grep passage extraction of a resumed page", () => {
  it("gives the rest of a cut passage and the passages after it", async () => {
    const text = numbered(22, (line) =>
      line <= 5 || (line >= 20 && line <= 21) ? "hit" : `l${line}`,
    );
    const result = await scan(text, ["hit"], {
      resume: { startLine: 1, endLine: 3, truncated: false },
    });
    expect(locatorsOf(result)).toEqual(["file.md:4-6", "file.md:19-22"]);
  });

  it("starts at the passage after a cursor that was not cut", async () => {
    const text = numbered(22, (line) =>
      line <= 5 || (line >= 20 && line <= 21) ? "hit" : `l${line}`,
    );
    const result = await scan(text, ["hit"], {
      resume: { startLine: 3, truncated: false },
    });
    expect(locatorsOf(result)).toEqual(["file.md:19-22"]);
  });

  it("gives the rest of the twentieth passage and nothing after it", async () => {
    const text = groupedPassages(22);
    const result = await scan(text, ["hit"], {
      resume: { startLine: 115, endLine: 115, truncated: true },
    });
    if (result.kind !== "passages") throw new Error("the file was refused");
    expect(result.passages.map((passage) => passage.locator)).toEqual([
      "file.md:116-118",
    ]);
    expect(result.passages[0].matches).toEqual([117]);
    expect(result.cappedAt).toBe(114);
  });

  it("ends the file as stopped when the deadline ends a line's tests", async () => {
    const scan = await scanGrepFile({
      fileLocator: "file.md",
      chunks: chunked("aaa\nhit\n"),
      // The probe fires between the two tests on the first line.
      patterns: {
        count: 2,
        matches: (_line, stopped) => (stopped?.() === true ? "stopped" : true),
      },
      maxFileBytes: null,
      deadline: () => true,
    });
    // A stopped line ends the file: its remaining patterns never ran, so it is
    // not known to miss, and the file must not report a complete page.
    expect(scan).toMatchObject({ kind: "stopped", reason: "deadline" });
  });

  it("falls back to the passages after the cursor's start when the file changed", async () => {
    const text = numbered(20, (line) => (line === 15 ? "hit" : "line"));
    const result = await scan(text, ["hit"], {
      resume: { startLine: 1, endLine: 5, truncated: false },
    });
    expect(locatorsOf(result)).toEqual(["file.md:14-16"]);
  });
});
