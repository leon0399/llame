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
import type { ReadSuccess } from "./source-lines";
import { measureNativeModelOutput } from "./serialization";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, opendir: vi.fn(original.opendir) };
});

function assertFileSuccess(
  result: Awaited<ReturnType<typeof readFile>>,
): asserts result is ReadSuccess {
  if (
    result.status !== "success" ||
    !("kind" in result) ||
    result.kind !== "file"
  )
    throw new Error("Expected file success result");
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
