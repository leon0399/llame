import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { truncateOversizedResult } from "@workspace/runtime-safety";
import { join } from "node:path";
import {
  loadText,
  selectSourceLines,
  readFile,
  MAX_RESULT_CODE_UNITS,
  splitSourceLines,
} from "./read";

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
      nextOffset: 0,
      truncated: true,
    });
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
    if (result.status !== "success") throw new Error("Expected source result");
    expect(result.content.endsWith("\n")).toBe(true);
    expect(result.nextOffset).toBe(result.shownRange?.endLine);
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
    expect(await readFile({ path: directory })).toMatchObject({
      status: "error",
      type: "not_regular_file",
    });
    expect(await readFile({ path: "/dev/null" })).toMatchObject({
      status: "error",
      type: "not_regular_file",
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
});
