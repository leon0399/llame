import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readFile,
  MAX_FILE_BYTES,
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
    await writeFile(path, "x\n".repeat(2002));
    expect(await readFile({ path })).toMatchObject({
      requestedRange: { startLine: 1, endLine: 2000 },
      shownRange: { startLine: 1, endLine: 2001 },
      nextOffset: 2000,
      truncated: true,
    });
    expect(await readFile({ path: `${path}:2001-2002` })).toMatchObject({
      content: "2000: x\n2001: x\n2002: x\n",
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
    expect(result).toMatchObject({ status: "success", truncated: true });
    if (result.status !== "success") throw new Error("Expected source result");
    expect(result.content.endsWith("\n")).toBe(true);
    expect(result.nextOffset).toBe(result.shownRange?.endLine);
  });

  it("rejects invalid UTF-8 and oversized source", async () => {
    await writeFile(path, Buffer.from([0xff]));
    expect(await readFile({ path })).toMatchObject({
      status: "error",
      type: "invalid_utf8",
    });
    await writeFile(path, Buffer.alloc(MAX_FILE_BYTES + 1));
    expect(await readFile({ path })).toMatchObject({
      status: "error",
      type: "file_too_large",
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
});
