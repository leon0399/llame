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
