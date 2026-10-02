import * as filesystem from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
import { applySelectorSuffix, invalidSelectorMessage } from "./path";
import type { MultiReadSuccess, SingleReadSuccess } from "./source-lines";
import { OUTLINE_UNSUPPORTED_MESSAGE } from "./representations";
import { measureNativeModelOutput } from "./serialization";
import { editFile } from "./mutate";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, opendir: vi.fn(original.opendir) };
});

const numbered = (count: number, fill = ""): string =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}${fill}\n`).join("");

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

  it("reads the last lines of a file through the count pass", async () => {
    await writeFile(path, numbered(500));
    const result = await readFile({ path: `${path}:-20` });
    assertFileSuccess(result);
    expect(result).toMatchObject({
      requestedRange: { startLine: 481, endLine: 500 },
      shownRange: { startLine: 480, endLine: 500 },
      truncated: false,
    });
    expect(result.content.startsWith("480: line 480\n481: line 481\n")).toBe(
      true,
    );
    expect(result.content.endsWith("500: line 500\n")).toBe(true);
  });

  it("clips a tail longer than the file to the whole file", async () => {
    await writeFile(path, numbered(10));
    expect(await readFile({ path: `${path}:-900` })).toMatchObject({
      requestedRange: { startLine: 1, endLine: 10 },
      shownRange: { startLine: 1, endLine: 10 },
      truncated: false,
    });
  });

  it("runs an open-ended member to the last line and continues past the cap", async () => {
    await writeFile(path, "\n".repeat(3000));
    const result = await readFile({ path: `${path}:50-` });
    assertFileSuccess(result);
    expect(result).toMatchObject({
      requestedRange: { startLine: 50, endLine: 3000 },
      shownRange: { startLine: 49, endLine: 2050 },
      truncated: true,
      nextOffset: 2049,
    });
    const resume = (result.nextOffset ?? 0) + 1;
    const resumed = await readFile({ path: `${path}:${resume}-` });
    assertFileSuccess(resumed);
    // The continuation resumes at its own requested line, with its context.
    expect(resumed.requestedRange).toEqual({
      startLine: resume,
      endLine: 3000,
    });
    expect(resumed.content.startsWith(`${resume - 1}: \n${resume}: \n`)).toBe(
      true,
    );
  });

  it("returns the empty result for a tail or open-ended member on an empty file", async () => {
    await writeFile(path, "");
    for (const selector of ["-5", "1-"]) {
      expect(await readFile({ path: `${path}:${selector}` })).toMatchObject({
        status: "success",
        content: "",
        requestedRange: null,
        truncated: false,
      });
    }
    expect(await readFile({ path: `${path}:5-` })).toMatchObject({
      status: "error",
      type: "invalid_selector",
    });
  });

  it.each(["-5,-10", "1-,1-2", "-5,3-4"])(
    "reads the comma request %s as an empty multi-range result on an empty file",
    async (selector) => {
      // The first requested start resolves empty, which is the shipped
      // start-past-EOF window; the plural fields keep it a multi-range read,
      // so it reports the empty ranges rather than a null single range.
      await writeFile(path, "");
      expect(await readFile({ path: `${path}:${selector}` })).toMatchObject({
        status: "success",
        content: "",
        requestedRanges: [],
        shownRanges: [],
        truncated: false,
      });
    },
  );

  it("refuses a comma request whose first start resolves past the last line", async () => {
    await writeFile(path, numbered(10));
    expect(await readFile({ path: `${path}:11-,12-` })).toMatchObject({
      status: "error",
      type: "invalid_selector",
    });
  });

  it.each([
    ["with a trailing LF", "one\ntwo\n", 2],
    ["without a trailing LF", "one\ntwo", 2],
    ["with CRLF terminators", "one\r\ntwo\r\n", 2],
    ["when empty", "", null],
  ])("counts %s the way the source models lines", async (_, source, end) => {
    await writeFile(path, source);
    // The file's last line is line `count`, so the tail member's resolved
    // `requestedRange` is the count the pass derived.
    expect(await readFile({ path: `${path}:-1` })).toMatchObject(
      end === null
        ? { status: "success", requestedRange: null }
        : { requestedRange: { endLine: end } },
    );
  });

  it("refuses a non-regular file before counting it", async () => {
    // A device has no end: the count pass would read forever, so the regular
    // -file check on the open handle runs first.
    expect(await readFile({ path: "/dev/zero:-5" })).toMatchObject({
      status: "error",
      type: "not_regular_file",
    });
  });

  it.each([":nonsense", ":-0", ":outline:1,3", ":5-10,,20-30"])(
    "names the working forms for the malformed selector %s",
    async (selector) => {
      await writeFile(path, "one\ntwo\n");
      expect(await readFile({ path: `${path}${selector}` })).toEqual({
        status: "error",
        type: "invalid_selector",
        message: invalidSelectorMessage(),
      });
    },
  );

  it("names the working forms for a member the bounds refuse", async () => {
    expect(await readFile({ path: `${directory}/notes:0-1` })).toMatchObject({
      status: "error",
      type: "invalid_selector",
      message: invalidSelectorMessage(),
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

  it.each([
    ["mdx", "# Heading\n"],
    ["txt", "# Heading\n"],
    ["json", "# Heading\n"],
    ["xml", "# Heading\n"],
    ["pdf", "# Heading\n"],
    ["bin", Buffer.from([0xff, 0x00, 0x01])],
  ])("rejects outline for a .%s source", async (extension, content) => {
    const sourcePath = join(directory, `source.${extension}`);
    await writeFile(sourcePath, content);
    expect(await readFile({ path: `${sourcePath}:outline` })).toEqual({
      status: "error",
      type: "invalid_selector",
      message: OUTLINE_UNSUPPORTED_MESSAGE,
    });
  });

  it("rejects outline for a directory", async () => {
    expect(await readFile({ path: `${directory}:outline` })).toEqual({
      status: "error",
      type: "invalid_selector",
      message: "The :outline member is not supported for directory reads.",
    });
  });

  it("uses the resolved host extension for readResolvedFile outline", async () => {
    const hostPath = join(directory, "SKILL.md");
    await writeFile(hostPath, "# Skill\n");
    const result = await readResolvedFile(hostPath, {
      displayPath: join(directory, "skill"),
      selector: "outline",
    });
    expect(result).toMatchObject({
      status: "success",
      path: join(directory, "skill"),
      representation: "outline",
      content: "1: # Skill\n",
    });
  });

  it("keeps a text range singular without Markdown ancestors", async () => {
    const sourcePath = join(directory, "source.txt");
    await writeFile(sourcePath, "# Heading\nbody\nvalue\n");
    expect(await readFile({ path: `${sourcePath}:2-2` })).toEqual({
      status: "success",
      kind: "file",
      path: sourcePath,
      representation: "text",
      content: "1: # Heading\n2: body\n3: value\n",
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 1, endLine: 3 },
      nextOffset: 2,
      truncated: false,
    });
  });

  it("bypasses Markdown ancestors in an edit preview", async () => {
    const sourcePath = join(directory, "preview.md");
    await writeFile(sourcePath, "# Root\nintro\nselected\ntrailing\n");
    expect(
      await editFile({
        path: sourcePath,
        oldText: "selected",
        newText: "changed",
      }),
    ).toEqual({
      status: "success",
      operation: "edit",
      path: sourcePath,
      replacements: 1,
      diff: "@@ replacement at line 3 @@\n-selected\n+changed\n",
      content: "2: intro\n3: changed\n4: trailing\n",
      shownRange: { startLine: 2, endLine: 4 },
      truncated: false,
    });
  });

  it("leaves ordinary and raw reads unchanged for a Markdown source", async () => {
    const sourcePath = join(directory, "same.md");
    await writeFile(sourcePath, "# Heading\nbody\n");
    expect(await readFile({ path: sourcePath })).toMatchObject({
      representation: "text",
      content: "1: # Heading\n2: body\n",
    });
    expect(await readFile({ path: `${sourcePath}:raw` })).toMatchObject({
      representation: "raw",
      content: "# Heading\nbody\n",
    });
  });

  it("scopes a Markdown read with an end-relative member", async () => {
    const sourcePath = join(directory, "guide.md");
    await writeFile(sourcePath, "# Title\nintro\n## Setup\nbody\ntail\n");
    expect(await readFile({ path: `${sourcePath}:-2` })).toEqual({
      status: "success",
      kind: "file",
      path: sourcePath,
      representation: "text",
      content: "1: # Title\n3: ## Setup\n4: body\n5: tail\n",
      requestedRanges: [{ startLine: 4, endLine: 5 }],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 5 },
      ],
      truncated: false,
    });
  });

  it("drops a later past-the-end member from a Markdown multi-range read", async () => {
    const sourcePath = join(directory, "guide.md");
    await writeFile(sourcePath, `# Title\n${"body\n".repeat(498)}`);
    const result = await readFile({ path: `${sourcePath}:1-5,501-` });
    assertMultiFileSuccess(result);
    expect(result).toMatchObject({
      requestedRanges: [{ startLine: 1, endLine: 5 }],
      shownRanges: [{ startLine: 1, endLine: 6 }],
      truncated: false,
    });
    expect(result.content).not.toContain("500: body");
  });

  it("scopes an outline with a tail member", async () => {
    const sourcePath = join(directory, "outline.md");
    await writeFile(
      sourcePath,
      `# Title\nintro\n## Setup\nbody\n## Use\nrun\n${"tail\n".repeat(10)}`,
    );
    const tail = await readFile({ path: `${sourcePath}:outline:-3` });
    assertFileSuccess(tail);
    expect(tail).toMatchObject({
      representation: "outline",
      requestedRange: { startLine: 14, endLine: 16 },
    });
    expect(tail.content).toContain("5: ## Use");
    const scoped = await readFile({ path: `${sourcePath}:outline:14-16` });
    expect(scoped).toEqual(tail);
  });

  it("recognizes and cuts an oversized Markdown heading", async () => {
    const sourcePath = join(directory, "large.md");
    await writeFile(sourcePath, `# ${"x".repeat(MAX_RESULT_CODE_UNITS + 1)}\n`);
    const result = await readFile({ path: `${sourcePath}:outline` });
    expect(result).toMatchObject({
      status: "success",
      representation: "outline",
      content: `1: # ${"x".repeat(118)}…\n`,
    });
  });
  it("keeps a dropped backtick from opening a fence", async () => {
    const sourcePath = join(directory, "large-info.md");
    const content = "```" + "x".repeat(20_000) + "`\n\n# Heading\n";
    await writeFile(sourcePath, content);
    const result = await readFile({ path: `${sourcePath}:outline` });
    assertFileSuccess(result);
    expect(result.content).toContain("3: # Heading\n");
  });

  it("keeps a dropped non-space from closing a fence", async () => {
    const sourcePath = join(directory, "large-closer.md");
    const content =
      "```\n" + "`".repeat(20_000) + "x\n# Hidden\n```\n# Shown\n";
    await writeFile(sourcePath, content);
    const result = await readFile({ path: `${sourcePath}:outline` });
    assertFileSuccess(result);
    expect(result.content).not.toContain("# Hidden");
    expect(result.content).toContain("5: # Shown\n");
  });

  it.each([
    [
      "a tilde fence closer",
      "~~~\n" + "~".repeat(20_000) + "\n# Hidden\n~~~\n# Shown\n",
      "1: ~~~\n3: # Hidden\n4: ~~~\n",
    ],
    [
      "an equals setext underline",
      "Title\n" + "=".repeat(20_000) + "\n# Kept\n",
      `1: Title\n2: ${"=".repeat(120)}…\n3: # Kept\n`,
    ],
    [
      "a dash setext underline",
      "Title\n" + "-".repeat(20_000) + "\n# Kept\n",
      `1: Title\n2: ${"-".repeat(120)}…\n3: # Kept\n`,
    ],
  ])(
    "keeps %s recognized past the oversized cut",
    async (_, content, outline) => {
      const sourcePath = join(directory, "large-marker.md");
      await writeFile(sourcePath, content);
      const result = await readFile({ path: `${sourcePath}:outline` });
      assertFileSuccess(result);
      expect(result.content).toBe(outline);
    },
  );
  it("keeps an oversized HTML block closer visible to the outline scanner", async () => {
    const sourcePath = join(directory, "large-script.md");
    await writeFile(
      sourcePath,
      `<script>${"x".repeat(20_000)}</script>\n\n# Heading\n\nbody\n`,
    );
    const result = await readFile({ path: `${sourcePath}:outline` });
    assertFileSuccess(result);
    expect(result.representation).toBe("outline");
    expect(result.content).toContain("3: # Heading\n5: body\n");
    expect(result.content).toMatch(/^1: <script>x+…\n/u);
  });

  it("finds an oversized HTML closer split across a read chunk", async () => {
    const sourcePath = join(directory, "split-script.md");
    const chunkSize = 64 * 1024;
    const closer = "</script>";
    const closerStart = chunkSize - 4;
    const opener = "<script>";
    const content =
      opener +
      "x".repeat(closerStart - opener.length) +
      closer +
      "\n\n# Heading\n\nbody\n";
    await writeFile(sourcePath, content);
    const result = await readFile({ path: `${sourcePath}:outline` });
    assertFileSuccess(result);
    expect(result.representation).toBe("outline");
    expect(result.content).toContain("3: # Heading\n5: body\n");
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

  it("refuses an unresolved target in the buffered reader", () => {
    // A caller holding text in hand knows its line count and places the
    // end-relative members itself; an unplaced target would otherwise be read
    // from line 1 under a range the request never named.
    expect(() =>
      selectSourceLines(numbered(10), applySelectorSuffix(path, "-3")),
    ).toThrow("invalid_selector");
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

    it("drops a later open-ended member that starts past the last line", async () => {
      await writeFile(path, numbered(500));
      const result = await readFile({ path: `${path}:1-5,501-` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [{ startLine: 1, endLine: 5 }],
        shownRanges: [{ startLine: 1, endLine: 6 }],
        truncated: false,
      });
      expect(result.content).toBe(
        `${Array.from({ length: 6 }, (_, i) => `${i + 1}: line ${i + 1}`).join("\n")}\n`,
      );
      expect(result.content).not.toContain("line 500");
    });

    it("resolves a tail and an open-ended member in one raw request", async () => {
      await writeFile(path, numbered(40));
      const canonical = await readFile({ path: `${path}:raw:1-5,30-` });
      assertMultiFileSuccess(canonical);
      const trailing = await readFile({ path: `${path}:1-5,30-:raw` });
      expect(trailing).toEqual(canonical);
      expect(canonical).toMatchObject({
        requestedRanges: [
          { startLine: 1, endLine: 5 },
          { startLine: 30, endLine: 40 },
        ],
        shownRanges: [
          { startLine: 1, endLine: 5 },
          { startLine: 30, endLine: 40 },
        ],
      });
      expect(canonical.content).toBe(
        Array.from({ length: 5 }, (_, i) => `line ${i + 1}\n`).join("") +
          Array.from({ length: 11 }, (_, i) => `line ${i + 30}\n`).join(""),
      );
    });

    it("resolves a tail member beside an absolute one", async () => {
      await writeFile(path, numbered(40));
      const result = await readFile({ path: `${path}:1-5,-20` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 1, endLine: 5 },
          { startLine: 21, endLine: 40 },
        ],
        shownRanges: [
          { startLine: 1, endLine: 6 },
          { startLine: 20, endLine: 40 },
        ],
        truncated: false,
      });
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

    it("rolls a later range back whole when its first line is oversized", async () => {
      await writeFile(
        path,
        `${"a\n".repeat(10)}${"x".repeat(MAX_RESULT_CODE_UNITS)}\n${`${"y".repeat(500)}\n`.repeat(10)}`,
      );
      const result = await readResolvedFile(path, {
        displayPath: "kb://space/a.md",
        selector: "2-3,12-20",
        reserveCodeUnits: MAX_RESULT_CODE_UNITS - 3000,
      });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 2, endLine: 3 },
          { startLine: 12, endLine: 20 },
        ],
        shownRanges: [{ startLine: 1, endLine: 4 }],
        truncated: true,
        nextOffset: 10,
      });
    });
    it("fails when the first requested start is just past EOF", async () => {
      await writeFile(path, "a\nb\nc\nd\ne\n");
      expect(await readFile({ path: `${path}:6-7,20-25` })).toMatchObject({
        status: "error",
        type: "invalid_selector",
      });
    });

    it("omits a later range in full when its entry line is oversized", async () => {
      await writeFile(
        path,
        `a\nb\nc\n${"p".repeat(MAX_RESULT_CODE_UNITS + 1)}\n${"\n".repeat(2096)}`,
      );
      const result = await readFile({ path: `${path}:1-1,5-2100` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 1, endLine: 1 },
          { startLine: 5, endLine: 2100 },
        ],
        shownRanges: [{ startLine: 1, endLine: 2 }],
        truncated: true,
        nextOffset: 3,
      });
    });

    it("counts only emittable lines against the shared ceiling", async () => {
      const lines = Array.from({ length: 2010 }, () => "\n");
      lines[99] = `${"p".repeat(16_001)}\n`;
      lines[100] = `${"p".repeat(16_001)}\n`;
      await writeFile(path, lines.join(""));
      const result = await readFile({ path: `${path}:1-1,7-2004` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 1, endLine: 1 },
          { startLine: 7, endLine: 2004 },
        ],
        shownRanges: [
          { startLine: 1, endLine: 2 },
          { startLine: 6, endLine: 99 },
          { startLine: 102, endLine: 2005 },
        ],
        truncated: true,
      });
      expect(result).not.toHaveProperty("nextOffset");
    });

    it("reads lines 1 through 7 exactly once for touching head ranges", async () => {
      await writeFile(path, numbered(10));
      const result = await readFile({ path: `${path}:1-2,5-6` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [
          { startLine: 1, endLine: 2 },
          { startLine: 5, endLine: 6 },
        ],
        shownRanges: [{ startLine: 1, endLine: 7 }],
        truncated: false,
      });
      expect(result.content).toBe(
        "1: line 1\n2: line 2\n3: line 3\n4: line 4\n5: line 5\n6: line 6\n7: line 7\n",
      );
    });

    it("reads one context-bounded block for unsorted overlapping ranges", async () => {
      await writeFile(path, numbered(35));
      const result = await readFile({ path: `${path}:20-30,5-10,10+10` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        requestedRanges: [{ startLine: 5, endLine: 30 }],
        shownRanges: [{ startLine: 4, endLine: 31 }],
        truncated: false,
      });
      expect(result.content.startsWith("4: line 4\n")).toBe(true);
      expect(result.content.endsWith("31: line 31\n")).toBe(true);
    });
  });

  describe("real path reporting", () => {
    let realDirectory: string;
    let realFile: string;
    let linkedDirectory: string;
    let linkedFile: string;

    beforeEach(async () => {
      realDirectory = join(directory, "real");
      linkedDirectory = join(directory, "link");
      realFile = join(realDirectory, "notes.md");
      linkedFile = join(linkedDirectory, "notes.md");
      await mkdir(realDirectory);
      await writeFile(realFile, "alpha\nbeta\n");
      await symlink(realDirectory, linkedDirectory);
    });

    it("reports the canonical path a linked directory component leads to", async () => {
      const result = await readFile({ path: linkedFile });
      assertFileSuccess(result);
      expect(result).toMatchObject({
        path: linkedFile,
        realPath: await realpath(realFile),
        content: "1: alpha\n2: beta\n",
      });
    });

    it("reports the canonical path a linked leaf leads to", async () => {
      const linkedLeaf = join(directory, "alias.md");
      await symlink(realFile, linkedLeaf);
      const result = await readFile({ path: linkedLeaf });
      assertFileSuccess(result);
      expect(result).toMatchObject({
        path: linkedLeaf,
        realPath: await realpath(realFile),
        content: "1: alpha\n2: beta\n",
      });
    });

    it("reports the canonical path on a multi-range read", async () => {
      await writeFile(
        realFile,
        Array.from({ length: 40 }, (_, i) => `line ${i + 1}\n`).join(""),
      );
      const result = await readFile({ path: `${linkedFile}:3-4,30-31` });
      assertMultiFileSuccess(result);
      expect(result).toMatchObject({
        path: linkedFile,
        realPath: await realpath(realFile),
        requestedRanges: [
          { startLine: 3, endLine: 4 },
          { startLine: 30, endLine: 31 },
        ],
      });
    });

    it("reports no real path for a link-free path written with dot segments", async () => {
      // Spelling the path from its canonical base keeps every component
      // link-free even where the temporary directory itself is reached
      // through a link.
      const base = await realpath(directory);
      const spelled = `${base}/real/../real/notes.md`;
      const result = await readFile({ path: spelled });
      assertFileSuccess(result);
      expect(result).toMatchObject({
        path: spelled,
        content: "1: alpha\n2: beta\n",
      });
      expect(result).not.toHaveProperty("realPath");
    });

    it("reports no real path on a directory listing", async () => {
      const result = await readFile({ path: linkedDirectory });
      expect(result).toMatchObject({
        status: "success",
        kind: "directory",
        path: linkedDirectory,
      });
      expect(result).not.toHaveProperty("realPath");
    });

    it("counts the real path against the shared result cap", async () => {
      // Every appended line is measured with `nextOffset` set, and one more
      // character on this single source line adds exactly one character to
      // that measurement. Calibrating the file to that cap leaves `realPath`
      // as the only measurement the linked read carries beyond the canonical
      // one, so it must drop the line the canonical read still shows. Both
      // components of the two paths are the same length, so the longer path
      // cannot be what overflows.
      await writeFile(realFile, "x\n");
      const baseline = await readFile({ path: realFile });
      assertFileSuccess(baseline);
      expect(baseline.truncated).toBe(false);
      const measured = (result: SingleReadSuccess) =>
        measureNativeModelOutput({ ...result, nextOffset: 1 });
      await writeFile(
        realFile,
        `${"x".repeat(MAX_RESULT_CODE_UNITS - measured(baseline) + 1)}\n`,
      );

      const canonical = await readFile({ path: realFile });
      const linked = await readFile({ path: linkedFile });
      assertFileSuccess(canonical);
      assertFileSuccess(linked);
      expect(linkedFile).toHaveLength(realFile.length);
      expect(measured(canonical)).toBe(MAX_RESULT_CODE_UNITS);
      expect(
        measureNativeModelOutput({
          ...canonical,
          path: linkedFile,
          realPath: await realpath(realFile),
          nextOffset: 1,
        }),
      ).toBeGreaterThan(MAX_RESULT_CODE_UNITS);
      expect(splitSourceLines(canonical.content)).toHaveLength(1);
      expect(splitSourceLines(linked.content)).toHaveLength(0);
      expect(linked).toMatchObject({ truncated: true, nextOffset: 1 });
      expect(linked.realPath).toBe(await realpath(realFile));
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

  it("places an end-relative member against the resolved file's line count", async () => {
    await writeFile(path, numbered(8));
    const result = await readResolvedFile(path, {
      displayPath: "skill://pdf/SKILL.md",
      selector: "-3",
    });
    assertFileSuccess(result);
    expect(result).toMatchObject({
      requestedRange: { startLine: 6, endLine: 8 },
      shownRange: { startLine: 5, endLine: 8 },
    });
    expect(result.content).toBe("5: line 5\n6: line 6\n7: line 7\n8: line 8\n");
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

  it("reads a linked SKILL.md when the caller follows links", async () => {
    const realDirectory = join(directory, "real");
    const packageDirectory = join(directory, "package");
    await mkdir(realDirectory);
    await mkdir(packageDirectory);
    await writeFile(join(realDirectory, "SKILL.md"), "# Skill\n");
    const link = join(packageDirectory, "SKILL.md");
    await symlink(join(realDirectory, "SKILL.md"), link);

    const result = await readResolvedFile(link, {
      displayPath: "skill://pdf/SKILL.md",
      followSymlinks: true,
    });
    assertFileSuccess(result);
    expect(result.content).toBe("1: # Skill\n");
  });

  it("lists a linked directory when the caller follows links", async () => {
    const realDirectory = join(directory, "real");
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, "notes.md"), "notes");
    const link = join(directory, "linked");
    await symlink(realDirectory, link);

    expect(
      await readResolvedFile(link, {
        displayPath: "skill://pdf/",
        followSymlinks: true,
      }),
    ).toStrictEqual({
      status: "success",
      kind: "directory",
      path: "skill://pdf/",
      content: "skill://pdf/\n  - notes.md\n",
      truncated: false,
    });
  });

  it("suggests siblings through a linked parent when the caller follows links", async () => {
    const parent = join(directory, "parent");
    await mkdir(parent);
    await writeFile(join(parent, "notes.md"), "unchanged");
    const linked = join(directory, "linked-parent");
    await symlink(parent, linked);

    expect(
      await readResolvedFile(join(linked, "notes.txt"), {
        displayPath: "skill://pdf/notes.txt",
        followSymlinks: true,
      }),
    ).toStrictEqual({
      status: "error",
      type: "not_found",
      message: "File not found. Similar names in the same directory: notes.md.",
    });
  });

  it.runIf(process.platform !== "win32")(
    "refuses a linked FIFO before opening it when the caller follows links",
    async () => {
      const fifo = join(directory, "pipe");
      // Node cannot create a FIFO, so the host's own `mkfifo` does; the guard
      // keeps the case off platforms that have neither.
      await promisify(execFile)("mkfifo", [fifo]);
      const link = join(directory, "linked.md");
      await symlink(fifo, link);

      const opened = vi.spyOn(filesystem, "open");
      expect(
        await readResolvedFile(link, {
          displayPath: "skill://pdf/linked.md",
          followSymlinks: true,
        }),
      ).toMatchObject({ status: "error", type: "not_regular_file" });
      expect(opened).not.toHaveBeenCalled();
    },
  );

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

  it("reports no real path for a followed link on a scheme-resolved read", async () => {
    const realDirectory = join(directory, "real");
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, "notes.md"), "alpha\n");
    const linked = join(directory, "linked.md");
    await symlink(join(realDirectory, "notes.md"), linked);

    const result = await readResolvedFile(linked, {
      displayPath: "skill://pdf/linked.md",
      followSymlinks: true,
    });
    assertFileSuccess(result);
    expect(result).toMatchObject({
      path: "skill://pdf/linked.md",
      content: "1: alpha\n",
    });
    expect(result).not.toHaveProperty("realPath");
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

  it("discards suggestions within 2000 ms when long names exhaust the scoring budget", async () => {
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
    // The bound is the point: refusing an over-budget directory must cost a
    // fraction of scoring it. Measured on a 10,000-entry directory of 250-char
    // names, the early refusal takes ~70 ms while the same directory WITH the
    // budget lifted takes ~7,600 ms — two orders of magnitude apart, so a
    // generous wall-clock bound still fails if the refusal is removed. It is
    // generous because this measures a COLD `tsx` process, whose transpile and
    // module load vary by hundreds of milliseconds on a shared runner; the
    // earlier 200 ms bound flaked at 204-435 ms in CI while passing locally.
    expect(measured.elapsed).toBeLessThan(2000);

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
