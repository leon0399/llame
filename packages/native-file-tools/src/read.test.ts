import * as filesystem from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isNumber,
  isRecord,
  truncateOversizedResult,
} from "@workspace/runtime-safety";
import { join } from "node:path";
import {
  loadText,
  selectSourceLines,
  readFile,
  readResolvedFile,
  MAX_RESULT_CODE_UNITS,
  splitSourceLines,
} from "./read";
import type { MultiReadSuccess, SingleReadSuccess } from "./source-lines";
import { measureNativeModelOutput } from "./serialization";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, opendir: vi.fn(original.opendir) };
});

function assertFileSuccess(
  result: Awaited<ReturnType<typeof readFile>>,
): asserts result is SingleReadSuccess {
  if (
    result.status !== "success" ||
    !("kind" in result) ||
    result.kind !== "file"
  )
    throw new Error("Expected file success result");
}

function assertMultiFileSuccess(
  result: Awaited<ReturnType<typeof readFile>>,
): asserts result is MultiReadSuccess {
  if (
    result.status !== "success" ||
    !("kind" in result) ||
    result.kind !== "file" ||
    !("requestedRanges" in result)
  )
    throw new Error("Expected multi-range file success result");
}

describe("native source reads", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-read-"));
    path = join(directory, "source");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("caps an unselected read and continues before trailing context", async () => {
    await writeFile(path, "\n".repeat(2002));
    expect(await readFile({ path })).toMatchObject({
      requestedRange: { startLine: 1, endLine: 2000 },
      shownRange: { startLine: 1, endLine: 2001 },
      nextOffset: 2000,
      truncated: true,
    });
    expect(await readFile({ path: `${path}:2001-2002` })).toMatchObject({
      content: "2000: \n2001: \n2002: \n",
      truncated: false,
    });
  });

  it("reports no shown lines when a single source line cannot fit", async () => {
    await writeFile(path, "x".repeat(MAX_RESULT_CODE_UNITS));
    expect(await readFile({ path })).toMatchObject({
      content: "",
      shownRange: null,
      nextOffset: 1,
      truncated: true,
    });
  });

  it("advances nextOffset past an oversized line instead of retrying it forever", async () => {
    await writeFile(
      path,
      "x".repeat(MAX_RESULT_CODE_UNITS) + "\nsecond\nthird\n",
    );
    const first = await readFile({ path: `${path}:1-1` });
    expect(first).toMatchObject({
      content: "",
      nextOffset: 1,
      truncated: true,
    });
    assertFileSuccess(first);

    // A second read at nextOffset reaches the line right after the poison
    // one instead of re-fetching the same unreadable line forever.
    const resumeLine = first.nextOffset! + 1;
    expect(
      await readFile({ path: `${path}:raw:${resumeLine}-${resumeLine}` }),
    ).toMatchObject({ status: "success", content: "second\n" });
  });

  it("drops an unrenderable context line so a prefixed continuation advances", async () => {
    await writeFile(
      path,
      "x".repeat(MAX_RESULT_CODE_UNITS) + "\nsecond\nthird\n",
    );
    const first = await readFile({ path });
    expect(first).toMatchObject({
      content: "",
      nextOffset: 1,
      truncated: true,
    });
    assertFileSuccess(first);

    // The default prefixed read shows one preceding line, which lands back on
    // the unreadable line; dropping it is what keeps the range reachable.
    const resumeLine = first.nextOffset! + 1;
    expect(
      await readFile({ path: `${path}:${resumeLine}-${resumeLine}` }),
    ).toMatchObject({ status: "success", content: "2: second\n3: third\n" });
  });

  it("terminates with invalid_selector instead of looping when the oversized line is the file's last line", async () => {
    await writeFile(path, "x".repeat(MAX_RESULT_CODE_UNITS));
    const first = await readFile({ path: `${path}:1-1` });
    assertFileSuccess(first);
    const resumeLine = first.nextOffset! + 1;
    expect(
      await readFile({ path: `${path}:raw:${resumeLine}-${resumeLine}` }),
    ).toMatchObject({ status: "error", type: "invalid_selector" });
  });

  it("returns adjacent live lines in content with requested continuation", async () => {
    await writeFile(path, "a\nb\nc\nd\ne\n");
    expect(await readFile({ path: `${path}:2-3` })).toEqual({
      status: "success",
      kind: "file",
      path,
      representation: "text",
      content: "1: a\n2: b\n3: c\n4: d\n",
      requestedRange: { startLine: 2, endLine: 3 },
      shownRange: { startLine: 1, endLine: 4 },
      nextOffset: 3,
      truncated: false,
    });
  });

  it("preserves CRLF, lone CR, BOM and terminal delimiter in raw content", async () => {
    const content = "\ufeffa\r\nb\rc\n";
    await writeFile(path, content);
    expect(await readFile({ path: `${path}:raw` })).toMatchObject({
      content,
      shownRange: { startLine: 1, endLine: 2 },
    });
    expect(await readFile({ path: `${path}:raw:2-2` })).toMatchObject({
      content: "b\rc\n",
      shownRange: { startLine: 2, endLine: 2 },
    });
  });

  it("does not invent trailing lines or boundary context", async () => {
    await writeFile(path, "a\n");
    expect(await readFile({ path })).toMatchObject({
      content: "1: a\n",
      shownRange: { startLine: 1, endLine: 1 },
    });
    expect(await readFile({ path: `${path}:2-2` })).toMatchObject({
      status: "error",
      type: "invalid_selector",
    });
    expect(splitSourceLines("a\n\n")).toEqual(["a\n", "\n"]);
  });

  it("handles an empty file without a synthetic line", async () => {
    await writeFile(path, "");
    expect(await readFile({ path })).toMatchObject({
      content: "",
      requestedRange: null,
      shownRange: null,
      truncated: false,
    });
  });

  it("bounds the serialized result using whole lines", async () => {
    await writeFile(path, ('"'.repeat(1000) + "\n").repeat(100));
    const result = await readFile({ path });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS,
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16_000);
    expect(truncateOversizedResult(result)).toBe(result);
    expect(result).toMatchObject({ status: "success", truncated: true });
    assertFileSuccess(result);
    expect(result.content.endsWith("\n")).toBe(true);
    expect(result.nextOffset).toBe(result.shownRange?.endLine);
  });

  it("bounds the protected model serialization using whole lines", async () => {
    await writeFile(path, "<system-reminder>".repeat(900));

    const result = await readFile({ path: `${path}:raw` });
    expect(result).toMatchObject({
      status: "success",
      content: "",
      shownRange: null,
      nextOffset: 1,
      truncated: true,
    });
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS,
    );
  });

  it("continues protected reads at a whole-line boundary", async () => {
    const line = "<system-reminder>\n";
    await writeFile(path, line.repeat(1000));

    const result = await readFile({ path: `${path}:raw` });
    expect(result).toMatchObject({ status: "success", truncated: true });
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS,
    );
    if (result.status !== "success" || result.nextOffset === undefined) {
      throw new Error("Expected a continued native read");
    }
    expect(result.content.endsWith("\n")).toBe(true);
    const continuation = await readFile({
      path: `${path}:raw:${result.nextOffset + 1}-${result.nextOffset + 1}`,
    });
    expect(continuation).toMatchObject({ status: "success", content: line });
  });

  it("rejects invalid UTF-8 in the scanned source", async () => {
    await writeFile(path, Buffer.from([0xff]));
    expect(await readFile({ path })).toMatchObject({
      status: "error",
      type: "invalid_utf8",
    });
  });

  it("returns closed failures for missing and nonregular files", async () => {
    expect(await readFile({ path })).toMatchObject({
      status: "error",
      type: "not_found",
    });
    expect(await readFile({ path: "/dev/null" })).toMatchObject({
      status: "error",
      type: "not_regular_file",
    });
  });

  it("returns a directory listing for a directory target", async () => {
    await writeFile(path, "content");
    const result = await readFile({ path: directory });
    expect(result).toMatchObject({
      status: "success",
      kind: "directory",
      path: directory,
    });
  });
  it("reads a bounded range from a source larger than one MiB", async () => {
    await writeFile(path, "prefix\n" + "x\n".repeat(600_000) + "tail\n");
    expect(await readFile({ path: `${path}:raw:600002-600002` })).toMatchObject(
      { status: "success", content: "tail\n" },
    );
  });

  it("reads the head without buffering a huge sparse trailing line", async () => {
    const file = await open(path, "w");
    try {
      await file.write("first\nsecond\nthird\n");
      await file.truncate(256 * 1024 * 1024);
    } finally {
      await file.close();
    }
    expect(await readFile({ path: `${path}:1-1` })).toMatchObject({
      status: "success",
      content: "1: first\n2: second\n",
      truncated: false,
    });
  });
  it("loads complete edit input without a Knowledge-size ceiling", async () => {
    const source = "x".repeat(1_048_577);
    await writeFile(path, source);
    expect(await loadText(path)).toBe(source);
    await writeFile(path, Buffer.from([0xff]));
    await expect(loadText(path)).rejects.toMatchObject({
      type: "invalid_utf8",
    });
    await expect(loadText(directory)).rejects.toMatchObject({
      type: "not_regular_file",
    });
  });

  it("shares line and result semantics with buffered edit previews", async () => {
    const source = "a\r\nb\nc";
    await writeFile(path, source);
    const target = { path, offset: 1, limit: 1, raw: false };
    const buffered = selectSourceLines(source, target);
    expect(buffered.content).toBe("1: a\r\n2: b\n3: c");
    expect(await readFile({ path: `${path}:2-2` })).toEqual(buffered);
    expect(selectSourceLines(source, { ...target, raw: true }).content).toBe(
      "b\n",
    );
    expect(
      selectSourceLines("", { path, offset: 0, raw: false }),
    ).toMatchObject({ content: "", requestedRange: null });
    expect(() => selectSourceLines(source, { ...target, offset: 3 })).toThrow(
      "invalid_selector",
    );
    expect(
      selectSourceLines("x".repeat(30_000), { path, offset: 0, raw: false }),
    ).toMatchObject({ content: "", truncated: true });
    expect(
      selectSourceLines("\n".repeat(2001), { path, offset: 0, raw: false }),
    ).toMatchObject({ truncated: true, nextOffset: 2000 });
  });
  it("preserves requested bounds independently of observed EOF in both readers", async () => {
    const source = "\n".repeat(2002);
    const target = { path, offset: 0, limit: 10_000, raw: false };
    await writeFile(path, source);
    const streamed = await readFile({ path: `${path}:1+10000` });
    const buffered = selectSourceLines(source, target);
    expect(streamed).toMatchObject({
      requestedRange: { startLine: 1, endLine: 10_000 },
      shownRange: { startLine: 1, endLine: 2001 },
      truncated: true,
    });
    expect(streamed).toEqual(buffered);
    await writeFile(path, "only\n");
    expect(await readFile({ path: `${path}:1-10` })).toMatchObject({
      requestedRange: { startLine: 1, endLine: 10 },
      shownRange: { startLine: 1, endLine: 1 },
      truncated: false,
    });
  });

  describe("multi-range reads", () => {
    const numbered = (count: number, fill = ""): string =>
      Array.from({ length: count }, (_, i) => `line ${i + 1}${fill}\n`).join(
        "",
      );

    it("merges touching expansions into one block", async () => {
      await writeFile(path, numbered(12));
      const result = await readFile({ path: `${path}:4-5,7-8` });
      assertMultiFileSuccess(result);
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

    it("keeps disjoint windows separate across the gap", async () => {
      await writeFile(path, numbered(35));
      const result = await readFile({ path: `${path}:5-10,20-30` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 5, endLine: 10 },
          { startLine: 20, endLine: 30 },
        ],
        shownRanges: [
          { startLine: 4, endLine: 11 },
          { startLine: 19, endLine: 31 },
        ],
        truncated: false,
      });
      expect(result.content).toContain("11: line 11\n19: line 19\n");
      expect(result.content).not.toContain("line 12\n");
    });

    it("reads raw ranges verbatim", async () => {
      await writeFile(path, numbered(35));
      const result = await readFile({ path: `${path}:raw:5-10,20-30` });
      assertMultiFileSuccess(result);
      expect(result.representation).toBe("raw");
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 5, endLine: 10 },
          { startLine: 20, endLine: 30 },
        ],
        shownRanges: [
          { startLine: 5, endLine: 10 },
          { startLine: 20, endLine: 30 },
        ],
        truncated: false,
      });
      expect(result.content).toBe(
        Array.from({ length: 6 }, (_, i) => `line ${i + 5}\n`).join("") +
          Array.from({ length: 11 }, (_, i) => `line ${i + 20}\n`).join(""),
      );
    });

    it("omits a later range that cannot fit and continues on retry", async () => {
      await writeFile(path, numbered(40, "x".repeat(1000)));
      const result = await readFile({ path: `${path}:5-10,20-30` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 5, endLine: 10 },
          { startLine: 20, endLine: 30 },
        ],
        shownRanges: [{ startLine: 4, endLine: 11 }],
        truncated: true,
        nextOffset: 18,
      });
      const retry = await readFile({ path: `${path}:20-30` });
      assertFileSuccess(retry);
      expect(retry).toMatchObject({
        requestedRange: { startLine: 20, endLine: 30 },
        shownRange: { startLine: 19, endLine: 31 },
        truncated: false,
      });
    });

    it("splits only the first range at the shared line ceiling", async () => {
      await writeFile(path, "\n".repeat(5000));
      const result = await readFile({ path: `${path}:1-2500,4000-4010` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 1, endLine: 2500 },
          { startLine: 4000, endLine: 4010 },
        ],
        shownRanges: [{ startLine: 1, endLine: 2000 }],
        truncated: true,
        nextOffset: 2000,
      });
      const retry = await readFile({ path: `${path}:2001-2500,4000-4010` });
      assertMultiFileSuccess(retry);
      expect(retry).toMatchObject({
        shownRanges: [
          { startLine: 2000, endLine: 2501 },
          { startLine: 3999, endLine: 4011 },
        ],
        truncated: false,
      });
      expect(retry).not.toHaveProperty("nextOffset");
    });

    it("shares the line ceiling across ranges", async () => {
      await writeFile(path, "\n".repeat(4600));
      const result = await readFile({ path: `${path}:1-1499,3000-4500` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        shownRanges: [{ startLine: 1, endLine: 1500 }],
        truncated: true,
        nextOffset: 2998,
      });
      const retry = await readFile({ path: `${path}:3000-4500` });
      assertFileSuccess(retry);
      expect(retry).toMatchObject({
        requestedRange: { startLine: 3000, endLine: 4500 },
        shownRange: { startLine: 2999, endLine: 4501 },
        truncated: false,
      });
    });

    it("clips shown ranges at EOF", async () => {
      await writeFile(path, numbered(25, "x"));
      const result = await readFile({ path: `${path}:5-10,20-30,40-50` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 5, endLine: 10 },
          { startLine: 20, endLine: 30 },
          { startLine: 40, endLine: 50 },
        ],
        shownRanges: [
          { startLine: 4, endLine: 11 },
          { startLine: 19, endLine: 25 },
        ],
        truncated: false,
      });
      expect(result).not.toHaveProperty("nextOffset");
    });

    it("fails when the first requested start exceeds EOF", async () => {
      await writeFile(path, numbered(25, "x"));
      expect(await readFile({ path: `${path}:40-50,45-55` })).toMatchObject({
        status: "error",
        type: "invalid_selector",
      });
    });

    it("returns empty arrays for an empty file starting at line 1", async () => {
      await writeFile(path, "");
      const result = await readFile({ path: `${path}:1-1,2-3` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        content: "",
        requestedRanges: [],
        shownRanges: [],
        truncated: false,
      });
      expect(await readFile({ path: `${path}:2-3,4-5` })).toMatchObject({
        status: "error",
        type: "invalid_selector",
      });
    });

    it("skips an oversized line and continues past it", async () => {
      await writeFile(
        path,
        `${"x".repeat(MAX_RESULT_CODE_UNITS)}\n${numbered(9, "y")}`,
      );
      const result = await readFile({ path: `${path}:2-4,7-8` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 2, endLine: 4 },
          { startLine: 7, endLine: 8 },
        ],
        shownRanges: [{ startLine: 2, endLine: 9 }],
        truncated: true,
      });
      expect(result).not.toHaveProperty("nextOffset");
    });

    it("reports truncation without continuation past a final poison line", async () => {
      await writeFile(
        path,
        `${numbered(5, "y")}${"x".repeat(MAX_RESULT_CODE_UNITS)}\n`,
      );
      const result = await readFile({ path: `${path}:5-6,5-6` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [{ startLine: 5, endLine: 6 }],
        shownRanges: [{ startLine: 4, endLine: 5 }],
        truncated: true,
      });
      expect(result).not.toHaveProperty("nextOffset");
    });

    it("rejects comma selectors on directories", async () => {
      expect(await readFile({ path: `${directory}:5-10,20-30` })).toMatchObject(
        {
          status: "error",
          type: "invalid_selector",
        },
      );
    });

    it("stops a multi-range read when aborted", async () => {
      await writeFile(path, numbered(100));
      const abort = new AbortController();
      abort.abort();
      const result = await readResolvedFile(path, {
        displayPath: "kb://space/big.md",
        selector: "40-50,60-70",
        signal: abort.signal,
      });
      expect(result.status).toBe("error");
      expect("content" in result).toBe(false);
    });

    it("withholds the reserved envelope room from the shared cap", async () => {
      await writeFile(path, numbered(40, "x".repeat(300)));
      const full = await readResolvedFile(path, {
        displayPath: "kb://space/a.md",
        selector: "5-10,20-30",
      });
      const reserved = await readResolvedFile(path, {
        displayPath: "kb://space/a.md",
        selector: "5-10,20-30",
        reserveCodeUnits: 10_000,
      });
      assertMultiFileSuccess(full);
      assertMultiFileSuccess(reserved);
      expect(reserved.content.length).toBeLessThan(full.content.length);
      expect(measureNativeModelOutput(reserved)).toBeLessThanOrEqual(
        MAX_RESULT_CODE_UNITS - 10_000,
      );
    });

    it("fails invalid_selector when range metadata cannot fit", async () => {
      await writeFile(path, numbered(10));
      const members = Array.from(
        { length: 64 },
        (_, i) => `${i * 10 + 1}-${i * 10 + 2}`,
      ).join(",");
      expect(
        await readResolvedFile(path, {
          displayPath: "kb://space/a.md",
          selector: members,
          reserveCodeUnits: MAX_RESULT_CODE_UNITS - 100,
        }),
      ).toMatchObject({ status: "error", type: "invalid_selector" });
    });

    it("refuses multi-range targets in the buffered reader", () => {
      expect(() =>
        selectSourceLines("a\n", {
          path,
          offset: 0,
          raw: false,
          ranges: [{ offset: 0, limit: 1 }],
          expandedRanges: [{ offset: 0, limit: 2 }],
        }),
      ).toThrow("invalid_input");
    });
  });
});

describe("native reads resolved by a scheme owner", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-scheme-read-"));
    path = join(directory, "note.md");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("shows the display path and the pre-split selector", async () => {
    await writeFile(path, "a\nb\nc\nd\ne\n");
    const result = await readResolvedFile(path, {
      displayPath: "kb://space/note.md",
      selector: "2-3",
    });
    assertFileSuccess(result);
    expect(result).toMatchObject({
      path: "kb://space/note.md",
      requestedRange: { startLine: 2, endLine: 3 },
      shownRange: { startLine: 1, endLine: 4 },
    });
  });

  it("never reinterprets the host path as a selector or a scheme", async () => {
    const literal = join(directory, "kb://weird:name.md");
    await mkdir(join(directory, "kb:"), { recursive: true });
    const hostPath = literal.replace("kb://", "kb:/");
    await writeFile(hostPath, "only\n");
    const result = await readResolvedFile(hostPath, {
      displayPath: "kb://space/a.md",
    });
    assertFileSuccess(result);
    expect(result.content).toBe("1: only\n");
  });

  it("returns not_found for a symbolic link when links are refused", async () => {
    await writeFile(path, "secret\n");
    const link = join(directory, "link.md");
    await symlink(path, link);
    expect(
      await readResolvedFile(link, { displayPath: "kb://space/link.md" }),
    ).toMatchObject({ status: "error", type: "not_found" });
  });

  it("withholds the reserved envelope room from the shared cap", async () => {
    const line = "x".repeat(200);
    await writeFile(path, `${line}\n`.repeat(200));
    const full = await readResolvedFile(path, {
      displayPath: "kb://space/a.md",
    });
    const reserved = await readResolvedFile(path, {
      displayPath: "kb://space/a.md",
      reserveCodeUnits: 10_000,
    });
    assertFileSuccess(full);
    assertFileSuccess(reserved);
    expect(reserved.content.length).toBeLessThan(full.content.length);
    expect(measureNativeModelOutput(reserved)).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS - 10_000,
    );
  });

  it("stops consuming the file when the read is aborted", async () => {
    await writeFile(path, "line\n".repeat(50_000));
    const abort = new AbortController();
    abort.abort();
    const result = await readResolvedFile(path, {
      displayPath: "kb://space/big.md",
      signal: abort.signal,
    });
    // Without the signal reaching the loop this returns a full successful
    // window: the abort would only discard the promise, not the reading.
    expect(result.status).toBe("error");
    expect("content" in result).toBe(false);
  });

  it("headers a directory listing with the display path", async () => {
    await writeFile(path, "a\n");
    const result = await readResolvedFile(directory, {
      displayPath: "kb://space/",
    });
    expect(result).toMatchObject({
      status: "success",
      kind: "directory",
      path: "kb://space/",
    });
    expect(
      "content" in result && result.content.startsWith("kb://space/\n"),
    ).toBe(true);
  });
});

describe("missing file suggestions", () => {
  let directory: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), "native-suggestions-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ["notes.txt", "notes.md"],
    ["notes.txt:1-2", "notes.md"],
    ["abcdef.md", "abcxyz.md"],
    ["ab.txt", "ab.md"],
    [".env.local", ".env"],
    ["a.b.txt", "a.b.md"],
    ["Pet%20Projects.md", "Pet Projects.md"],
    ["cafe\u0301.md", "caf\u00e9.md"],
    ["e%CC%81.md", "\u00e9.md"],
    ["\u00e9.md", "e%CC%81.md"],
    ["notse.md", "notes.md"],
    ["cafoo.txt", "abcfoo.md"],
    ["NOTES.md", "notes.md"],
    ["Notes Standup 2026-09-08.md", "2026-09-08 Standup Notes.md"],
    ["100%25.md", "100%.md"],
    ["100%.md", "100%25.md"],
  ])("suggests %s as %s", async (requested, sibling) => {
    await writeFile(join(directory, sibling), "unchanged");
    expect(await readFile({ path: join(directory, requested) })).toStrictEqual({
      status: "error",
      type: "not_found",
      message: `File not found. Similar names in the same directory: ${sibling}.`,
    });
  });

  it.each([
    ["ab", "ac"],
    ["-a", "a-"],
    ["abcdef.txt", "abcxyz.md"],
    ["notes", "unrelated"],
    ["notes", "a-very-long-unrelated-filename"],
  ])("does not suggest %s as %s", async (requested, sibling) => {
    await writeFile(join(directory, sibling), "unchanged");
    expect(await readFile({ path: join(directory, requested) })).toStrictEqual({
      status: "error",
      type: "not_found",
      message: "File not found.",
    });
  });

  it("does not suggest a dangling link as its own recovery", async () => {
    await symlink(join(directory, "absent"), join(directory, "notes.md"));
    await writeFile(join(directory, "notes.txt"), "readable");
    expect(await readFile({ path: join(directory, "notes.md") })).toStrictEqual(
      {
        status: "error",
        type: "not_found",
        message:
          "File not found. Similar names in the same directory: notes.txt.",
      },
    );
  });

  it("ranks extension mismatches at the same score as one edit in ten characters", async () => {
    for (const name of ["abcdefghij.md", "abcdefghik.txt"]) {
      await writeFile(join(directory, name), "unchanged");
    }
    expect(
      await readFile({ path: join(directory, "abcdefghij.txt") }),
    ).toMatchObject({
      message:
        "File not found. Similar names in the same directory: abcdefghij.md, abcdefghik.txt.",
    });
  });

  it("sorts ties by name and returns at most five", async () => {
    for (const name of [
      "notes6",
      "notes3",
      "notes5",
      "notes1",
      "notes4",
      "notes2",
    ]) {
      await writeFile(join(directory, name), "unchanged");
    }
    expect(await readFile({ path: join(directory, "notes0") })).toMatchObject({
      message:
        "File not found. Similar names in the same directory: notes1, notes2, notes3, notes4, notes5.",
    });
  });

  it("reports a missing parent without listing another directory", async () => {
    const opened = vi.spyOn(filesystem, "opendir");
    expect(
      await readFile({ path: join(directory, "missing", "notes.md") }),
    ).toMatchObject({
      type: "not_found",
      message: "File not found. Parent directory does not exist.",
    });
    expect(opened).not.toHaveBeenCalled();
  });

  it("refuses a linked parent for resolved reads and follows it for host reads", async () => {
    const parent = join(directory, "parent");
    const linked = join(directory, "linked");
    await mkdir(parent);
    await writeFile(join(parent, "notes.md"), "unchanged");
    await symlink(parent, linked);
    const hostPath = join(linked, "notes.txt");
    expect(
      await readResolvedFile(hostPath, { displayPath: "kb://space/notes.txt" }),
    ).toStrictEqual({
      status: "error",
      type: "not_found",
      message: "File not found.",
    });
    expect(await readFile({ path: hostPath })).toMatchObject({
      message: "File not found. Similar names in the same directory: notes.md.",
    });
  });

  it("does not suggest for a trailing separator on either authority", async () => {
    await writeFile(join(directory, "notes.md"), "unchanged");
    const path = `${join(directory, "notes.txt")}/`;
    const opened = vi.spyOn(filesystem, "opendir");
    for (const result of [
      await readFile({ path }),
      await readResolvedFile(path, { displayPath: "kb://space/notes.txt/" }),
    ]) {
      expect(result).toMatchObject({ type: "not_found" });
      if (result.status !== "error")
        throw new Error("Expected a missing target");
      expect(result.message).not.toContain("Similar names");
    }
    expect(opened).not.toHaveBeenCalled();
  });

  it("does no directory read on successful file reads", async () => {
    const path = join(directory, "notes.md");
    await writeFile(path, "source");
    const opened = vi.spyOn(filesystem, "opendir");
    expect(await readFile({ path })).toMatchObject({
      status: "success",
      content: "1: source",
    });
    expect(
      await readResolvedFile(path, { displayPath: "kb://space/notes.md" }),
    ).toMatchObject({ status: "success" });
    expect(opened).not.toHaveBeenCalled();
  });

  it("preserves directory elision and root continuation under output bounds", async () => {
    for (const child of ["alpha", "beta"]) {
      await mkdir(join(directory, child));
      for (const prefix of ["0", "1", "2"]) {
        await writeFile(join(directory, child, prefix + "x".repeat(99)), "");
      }
    }
    const lastName = "z" + "x".repeat(99);
    await writeFile(join(directory, lastName), "");
    const partial = await readResolvedFile(directory, {
      displayPath: "kb://space/",
      reserveCodeUnits: MAX_RESULT_CODE_UNITS - 700,
    });
    expect(partial).toMatchObject({
      status: "success",
      kind: "directory",
      truncated: true,
    });
    expect(partial).toHaveProperty(
      "content",
      expect.stringContaining(`  - alpha/\n    - 0${"x".repeat(99)}`),
    );
    expect(partial).toHaveProperty(
      "content",
      expect.stringContaining(`  - beta/\n    … 3 entries\n  - ${lastName}`),
    );
    expect(measureNativeModelOutput(partial)).toBeLessThanOrEqual(700);

    const truncated = await readResolvedFile(directory, {
      displayPath: "kb://space/",
      reserveCodeUnits: MAX_RESULT_CODE_UNITS - 250,
    });
    expect(truncated).toMatchObject({
      content:
        "kb://space/\n  - alpha/\n    … 3 entries\n  - beta/\n    … 3 entries\n",
      truncated: true,
      nextOffset: 2,
    });
    expect(measureNativeModelOutput(truncated)).toBeLessThanOrEqual(250);
    expect(
      await readResolvedFile(directory, {
        displayPath: "kb://space/",
        selector: "3-5",
        reserveCodeUnits: MAX_RESULT_CODE_UNITS - 250,
      }),
    ).toMatchObject({
      content: `kb://space/\n  - ${lastName}\n`,
      truncated: false,
    });

    const flat = await readResolvedFile(directory, {
      displayPath: "kb://space/",
      selector: "1-5",
      reserveCodeUnits: MAX_RESULT_CODE_UNITS - 200,
    });
    expect(flat).toMatchObject({
      content: "kb://space/\n  - alpha/\n  - beta/\n",
      truncated: true,
      nextOffset: 2,
    });
    expect(measureNativeModelOutput(flat)).toBeLessThanOrEqual(200);
  });

  it("counts token retries against the same scoring budget", async () => {
    await mkdir(join(directory, "a".repeat(254)));
    for (let index = 0; index < 70; index++) {
      await mkdir(
        join(directory, `${String(index).padStart(5, "0")}${"b".repeat(250)}`),
      );
    }
    expect(
      await readFile({ path: join(directory, "a".repeat(255)) }),
    ).toStrictEqual({
      status: "error",
      type: "not_found",
      message: "File not found.",
    });
  });

  it("discards suggestions within 200 ms when long names exhaust the scoring budget", async () => {
    for (let index = 0; index < 10_000; index++) {
      await mkdir(
        join(directory, `${String(index).padStart(5, "0")}${"a".repeat(250)}`),
      );
    }
    const opened = vi.spyOn(filesystem, "opendir");
    const result = await readFile({ path: join(directory, "a".repeat(255)) });
    expect(result).toStrictEqual({
      status: "error",
      type: "not_found",
      message: "File not found.",
    });
    expect(opened).toHaveBeenCalledTimes(1);

    // Coverage instrumentation changes DP latency; measure the same source in
    // a fresh process while the read above retains behavioral coverage.
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      "--eval",
      `const { readFile } = require('./src/read.ts');
       const started = performance.now();
       readFile({ path: process.argv[1] }).then(result => {
         console.log(JSON.stringify({ elapsed: performance.now() - started, result }));
       });`,
      join(directory, "a".repeat(255)),
    ]);
    const measured: unknown = JSON.parse(stdout);
    if (!isRecord(measured) || !isNumber(measured.elapsed))
      throw new Error("Missing timing result");
    expect(measured.result).toStrictEqual(result);
    expect(measured.elapsed).toBeLessThan(200);

    // A plausible name cannot be emitted from a directory over the entry cap.
    await mkdir(join(directory, "notes.md"));
    expect(
      await readFile({ path: join(directory, "notes.txt") }),
    ).toStrictEqual({
      status: "error",
      type: "not_found",
      message: "File not found.",
    });
  }, 30_000);
});
