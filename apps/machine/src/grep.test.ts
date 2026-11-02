import { execFile } from "node:child_process";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FS_GREP_METHOD,
  fsGrepCursorKey,
  isIntegerValue,
  isSerializableRecord,
  isStringValue,
  PATH_NOT_REGISTERED_MESSAGE,
  type FsGrepBounds,
  type FsGrepParams,
  type FsGrepPassage,
  type JsonValue,
  type SerializableValue,
} from "@workspace/machine-protocol";
import {
  compileGrepPatterns,
  decodeGrepCursor,
  encodeGrepCursor,
  grepContinuationUnits,
  measureGrepRendering,
  runGrepScan,
  type GrepBudget,
  type GrepWalkPort,
} from "@workspace/native-file-tools";
import { isBoolean } from "@workspace/runtime-safety";
import { createGrepWalkPort } from "./grep-port";
import { createRootGuard } from "./guard";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import { envelope, startDaemon, type TestDaemon } from "./testing/harness";

let fixture: RootFixture;
let daemon: TestDaemon;

/** The bounds a hub request carries; the daemon maps them to its own budget. */
const BOUNDS: FsGrepBounds = {
  files: 5000,
  entries: 20_000,
  bytes: 32 * 1024 * 1024,
  fileBytes: null,
  deadlineMs: 30_000,
  limit: 20,
  pageUnits: 15_000,
  progressed: false,
};

/** An unbound engine budget, for the walks this file builds itself. */
const ENGINE_BUDGET: GrepBudget = {
  files: null,
  entries: null,
  bytes: null,
  maxFileBytes: null,
  deadlineMs: 30_000,
  limit: 20,
  pageUnits: 15_000,
  fixedReserve: 0,
};

beforeEach(async () => {
  fixture = await createRootFixture();
  daemon = startDaemon({ roots: [fixture.root] });
  const hello = await daemon.hello();
  expect(hello.ok).toBe(true);
});

afterEach(async () => {
  daemon.input.end();
  await daemon.session.done;
  await fixture.cleanup();
});

async function writeAt(relative: string, content: string): Promise<string> {
  const target = join(fixture.root, ...relative.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

/** A file whose lines match every fourth line, starting at line 1. */
function spacedMatches(count: number): string {
  const lines: Array<string> = [];
  for (let index = 0; index < count; index += 1)
    lines.push("needle", "filler", "filler", "filler");
  return lines.join("\n");
}

/** A page bound that leaves `room` units for one file's passages. */
function pageRoom(rel: string, startLine: number, room: number): number {
  return grepContinuationUnits({ scopeIndex: 0, rel, startLine }) + room;
}

/** The page units a run of daemon passages renders to. */
function unitsOf(passages: ReadonlyArray<FsGrepPassage>): number {
  return measureGrepRendering({
    results: passages.map((passage) => ({
      locator: `${passage.path}:${String(passage.startLine)}-${String(passage.endLine)}`,
      content: passage.content,
      matches: passage.matches,
    })),
    complete: true,
  });
}

function request(
  path: string,
  overrides: Partial<FsGrepParams> = {},
): FsGrepParams {
  return {
    envelope: envelope(),
    path,
    patterns: ["needle"],
    literal: false,
    ignoreCase: false,
    bounds: BOUNDS,
    ...overrides,
  };
}

/** One warning the answer counted. */
type GrepWarning = { readonly kind: string; readonly count: number };

/** The answer's success half, parsed at the wire boundary. */
type GrepPage = {
  readonly results: ReadonlyArray<FsGrepPassage>;
  readonly complete: boolean;
  readonly warnings: ReadonlyArray<GrepWarning>;
  readonly consumed: {
    readonly files: number;
    readonly entries: number;
    readonly bytes: number;
  };
  readonly cursor: string | undefined;
  readonly progressed: boolean;
  readonly unfinished: string | undefined;
  readonly ignored:
    | { readonly paths: ReadonlyArray<string>; readonly atLeast: boolean }
    | undefined;
};

function parsePassage(value: SerializableValue): FsGrepPassage {
  if (!isSerializableRecord(value)) throw new Error("a passage is an object");
  const { path, startLine, endLine, content, matches, truncated, capped, cut } =
    value;
  if (!isStringValue(path) || !isStringValue(content)) {
    throw new Error("a passage carries its path and content");
  }
  if (!isIntegerValue(startLine) || !isIntegerValue(endLine)) {
    throw new Error("a passage carries its line range");
  }
  if (!Array.isArray(matches)) throw new Error("a passage carries its matches");
  const lines: ReadonlyArray<SerializableValue> = matches;
  if (!lines.every(isIntegerValue)) throw new Error("a match is a line number");
  return {
    path,
    startLine,
    endLine,
    content,
    matches: [...lines],
    ...(truncated === true && { truncated: true }),
    ...(capped === true && { capped: true }),
    ...(cut === true && { cut: true }),
  };
}

function parseList<T>(
  value: SerializableValue,
  parse: (entry: SerializableValue) => T,
): ReadonlyArray<T> {
  if (!Array.isArray(value)) throw new Error("the answer carries no list");
  const entries: ReadonlyArray<SerializableValue> = value;
  return entries.map(parse);
}

function parseWarning(value: SerializableValue): GrepWarning {
  if (!isSerializableRecord(value)) throw new Error("a warning is an object");
  const { kind, count } = value;
  if (!isStringValue(kind) || !isIntegerValue(count)) {
    throw new Error("a warning names a kind and a count");
  }
  return { kind, count };
}

function parseGrep(answer: JsonValue): GrepPage {
  if (!isSerializableRecord(answer) || answer["ok"] !== true)
    throw new Error("expected a successful search");
  const { complete, cursor, consumed } = answer;
  if (!isBoolean(complete)) throw new Error("the answer is partial");
  if (!isSerializableRecord(consumed))
    throw new Error("the answer has no budget");
  const { files, entries, bytes } = consumed;
  if (
    !isIntegerValue(files) ||
    !isIntegerValue(entries) ||
    !isIntegerValue(bytes)
  )
    throw new Error("the consumed budget is malformed");
  const { progressed, unfinished, ignored: ignoredValue } = answer;
  if (!isBoolean(progressed)) throw new Error("the answer has no progress");
  if (unfinished !== undefined && !isStringValue(unfinished))
    throw new Error("the unfinished file is malformed");
  const ignored = parseIgnored(ignoredValue);
  return {
    results: parseList(answer["results"], parsePassage),
    complete,
    warnings: parseList(answer["warnings"], parseWarning),
    consumed: { files, entries, bytes },
    cursor: isStringValue(cursor) ? cursor : undefined,
    progressed,
    unfinished: isStringValue(unfinished) ? unfinished : undefined,
    ignored,
  };
}

/** The excluded directories an answer names, relative to its prefix. */
function parseIgnored(
  value: SerializableValue,
):
  | { readonly paths: ReadonlyArray<string>; readonly atLeast: boolean }
  | undefined {
  if (value === undefined) return undefined;
  if (!isSerializableRecord(value)) throw new Error("ignored is an object");
  const { paths, atLeast } = value;
  if (!Array.isArray(paths) || !paths.every(isStringValue))
    throw new Error("ignored carries its paths");
  if (!isBoolean(atLeast)) throw new Error("ignored carries its bound");
  return { paths: [...paths], atLeast };
}

async function grep(params: FsGrepParams): Promise<GrepPage> {
  return parseGrep(await daemon.call(FS_GREP_METHOD, params));
}

function pathsOf(page: GrepPage): ReadonlyArray<string> {
  return page.results.map((passage) => passage.path);
}

/** A FIFO at `target`; `mkfifo` is the one reliable way to make one. */
async function makeFifo(target: string): Promise<void> {
  await promisify(execFile)("mkfifo", [target]);
}

/** Every byte a streamed open yields, in order. */
async function collectChunks(
  chunks: AsyncIterable<Uint8Array | { readonly kind: string }>,
): Promise<Buffer> {
  const parts: Array<Uint8Array> = [];
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array))
      throw new Error(`refused: ${chunk.kind}`);
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

describe("fs.grep", () => {
  it("walks a glob scope and names paths relative to its prefix", async () => {
    await writeAt("project/a.go", "package a\n// needle\n");
    await writeAt("project/nested/c.go", "needle\n");
    await writeAt("project/d.md", "needle\n");
    const prefix = join(fixture.root, "project");
    const answer = await daemon.call(
      FS_GREP_METHOD,
      request(prefix, { globSuffix: "**/*.go", patterns: ["needle"] }),
    );
    const page = parseGrep(answer);
    expect(pathsOf(page)).toEqual(["a.go", "nested/c.go"]);
    expect(page.results[0]).toMatchObject({
      path: "a.go",
      startLine: 1,
      endLine: 2,
      matches: [2],
    });
    // Nothing the daemon answers may name a host path.
    expect(JSON.stringify(answer)).not.toContain(fixture.root);
  });

  it("applies the prefix's ignore rules", async () => {
    await writeAt("project/.gitignore", "ignored/\n");
    await writeAt("project/ignored/b.go", "needle\n");
    await writeAt("project/a.go", "needle\n");
    expect(pathsOf(await grep(request(join(fixture.root, "project"))))).toEqual(
      ["a.go"],
    );
  });

  it("reads .ignore beside .gitignore with the deeper file deciding", async () => {
    await writeAt("project/.gitignore", "build/\n");
    await writeAt("project/.ignore", "!build/\n");
    await writeAt("project/build/app.go", "needle\n");
    expect(pathsOf(await grep(request(join(fixture.root, "project"))))).toEqual(
      ["build/app.go"],
    );
  });

  it("applies the ignore files of the registered root", async () => {
    await writeAt(".ignore", "cache/\n");
    await writeAt("project/cache/b.go", "needle\n");
    await writeAt("project/a.go", "needle\n");
    expect(pathsOf(await grep(request(join(fixture.root, "project"))))).toEqual(
      ["a.go"],
    );
  });

  it("treats the registered root as the repository boundary under an outer repository", async () => {
    await writeAt(".gitignore", "dist/\n");
    // A repository above the registered root is not consulted.
    await writeFile(join(fixture.base, ".gitignore"), "dist/\n*.md\n");
    await mkdir(join(fixture.base, ".git"));
    await writeAt("packages/api/dist/out.go", "needle\n");
    await writeAt("packages/api/README.md", "needle\n");
    await writeAt("packages/api/a.go", "needle\n");
    expect(
      pathsOf(await grep(request(join(fixture.root, "packages/api")))),
    ).toEqual(["README.md", "a.go"]);
  });

  it("limits a .gitignore above the prefix to its repository", async () => {
    await writeAt(".gitignore", "*.md\n");
    await mkdir(join(fixture.root, "a/.git"), { recursive: true });
    await writeAt("a/.gitignore", "dist/\n");
    await writeAt("a/sub/README.md", "needle\n");
    await writeAt("a/sub/dist/out.go", "needle\n");
    expect(pathsOf(await grep(request(join(fixture.root, "a/sub"))))).toEqual([
      "README.md",
    ]);
  });

  it("treats a .git file as a repository", async () => {
    await writeAt(".gitignore", "*.md\n");
    await writeAt("b/.git", "gitdir: elsewhere\n");
    await writeAt("b/sub/README.md", "needle\n");
    expect(pathsOf(await grep(request(join(fixture.root, "b/sub"))))).toEqual([
      "README.md",
    ]);
  });

  it("never searches a .ignore of the scope", async () => {
    await writeAt("project/.ignore", "needle\n");
    await writeAt("project/a.go", "needle\n");
    expect(pathsOf(await grep(request(join(fixture.root, "project"))))).toEqual(
      ["a.go"],
    );
  });

  it("reports the excluded directory the hub spells as a scope", async () => {
    await writeAt("project/.gitignore", "node_modules/\n");
    await writeAt("project/node_modules/dep.js", "needle\n");
    await writeAt("project/a.go", "needle\n");
    const page = await grep(request(join(fixture.root, "project")));
    expect(pathsOf(page)).toEqual(["a.go"]);
    expect(page.ignored).toEqual({
      paths: ["node_modules"],
      atLeast: false,
    });
  });

  it("continues a page from its own cursor", async () => {
    await writeAt("project/a.go", "needle\n");
    await writeAt("project/b.go", "needle\n");
    const prefix = join(fixture.root, "project");
    const first = await grep(
      request(prefix, { bounds: { ...BOUNDS, limit: 1 } }),
    );
    expect(pathsOf(first)).toEqual(["a.go"]);
    expect(first.complete).toBe(false);
    if (first.cursor === undefined)
      throw new Error("the page carries a cursor");
    const second = await grep(
      request(prefix, {
        bounds: { ...BOUNDS, limit: 1 },
        cursor: first.cursor,
      }),
    );
    expect(pathsOf(second)).toEqual(["b.go"]);
    expect(second.complete).toBe(true);
  });

  it("forwards the call's progress and returns its own", async () => {
    // A 100 KiB file passes the first probe and crosses the byte bound before
    // its second chunk, so the walk stops inside it.
    await writeAt("project/big.log", `${"x".repeat(63)}\n`.repeat(2000));
    const prefix = join(fixture.root, "project/big.log");
    const stopped = await grep(
      request(prefix, { bounds: { ...BOUNDS, bytes: 4 } }),
    );
    expect(stopped.progressed).toBe(false);
    expect(stopped.unfinished).toBe("");
    expect(stopped.complete).toBe(false);

    const progressed = await grep(
      request(prefix, { bounds: { ...BOUNDS, bytes: 4, progressed: true } }),
    );
    expect(progressed.progressed).toBe(true);
    expect(progressed.unfinished).toBeUndefined();
    expect(progressed.complete).toBe(false);
  });

  it("refuses a cursor issued for other search inputs", async () => {
    await writeAt("project/a.go", "needle\n");
    const prefix = join(fixture.root, "project");
    const cursor = encodeGrepCursor({
      scopeIndex: 0,
      rel: "a.go",
      startLine: 1,
      inputHash: fsGrepCursorKey({
        path: prefix,
        patterns: ["other"],
        literal: false,
        ignoreCase: false,
      }),
    });
    const outcome = await daemon.attempt(
      FS_GREP_METHOD,
      request(prefix, { cursor }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: "invalid_params" });
  });

  it("refuses a request that carries no bounds", async () => {
    await writeAt("project/a.go", "needle\n");
    // The legacy shape a pre-rename hub sends: a `budget` object and no
    // `bounds` key. The daemon must refuse it rather than run with old
    // bounds, even though a daemon of that other build would accept it.
    const full = request(join(fixture.root, "project"));
    const legacy = { ...full, budget: { ...BOUNDS } };
    Reflect.deleteProperty(legacy, "bounds");
    const outcome = await daemon.attempt(FS_GREP_METHOD, legacy);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: "invalid_params" });
  });

  it("refuses a prefix outside the registered roots", async () => {
    const outcome = await daemon.attempt(
      FS_GREP_METHOD,
      request(fixture.outside),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({
      name: "MachineProtocolError",
      code: "path_not_registered",
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it("refuses a bare root when it is not registered", async () => {
    const outcome = await daemon.attempt(
      FS_GREP_METHOD,
      request("/", { globSuffix: "**" }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: "path_not_registered" });
  });

  it("reports a consumed budget across the files it opened", async () => {
    await writeAt("project/a.go", "needle\n");
    await writeAt("project/b.go", "needle\n");
    const page = await grep(
      request(join(fixture.root, "project"), {
        bounds: { ...BOUNDS, files: 1 },
      }),
    );
    expect(pathsOf(page)).toEqual(["a.go"]);
    expect(page.consumed).toEqual({ files: 1, entries: 2, bytes: 7 });
    expect(page.complete).toBe(false);
    expect(page.warnings).toEqual([{ kind: "file_bound", count: 1 }]);
  });

  it("searches a file whose chunk passes the byte bound and stops the next one", async () => {
    await writeAt("project/a.go", "needle one\n");
    await writeAt("project/b.go", "needle two\n");
    const prefix = join(fixture.root, "project");
    const page = await grep(
      request(prefix, { bounds: { ...BOUNDS, bytes: 1 } }),
    );
    // A file of any size is searched: `a.go` is one chunk, so the 1-byte bound
    // is crossed after its bytes and never cuts it. The bound then stops the
    // walk before `b.go`, and the call progressed, so no file is unfinished.
    expect(pathsOf(page)).toEqual(["a.go"]);
    expect(page.progressed).toBe(true);
    expect(page.unfinished).toBeUndefined();
    expect(page.complete).toBe(false);
    expect(page.warnings).toEqual([{ kind: "byte_bound", count: 1 }]);
    if (page.cursor === undefined) throw new Error("the page carries a cursor");
    expect(
      decodeGrepCursor(
        page.cursor,
        fsGrepCursorKey({
          path: prefix,
          patterns: ["needle"],
          literal: false,
          ignoreCase: false,
        }),
      ),
    ).toMatchObject({ kind: "passage", rel: "a.go" });

    // The passage cursor resumes after `a.go`: the walk re-lists it, opens
    // nothing of it, and searches `b.go`.
    const second = await grep(request(prefix, { cursor: page.cursor }));
    expect(pathsOf(second)).toEqual(["b.go"]);
    expect(second.complete).toBe(true);
  });

  it("skips a file over the file-size bound the request carries", async () => {
    await writeAt("project/a.go", "needle\n");
    const page = await grep(
      request(join(fixture.root, "project"), {
        bounds: { ...BOUNDS, fileBytes: 4 },
      }),
    );
    expect(pathsOf(page)).toEqual([]);
    expect(page.warnings).toEqual([{ kind: "oversized", count: 1 }]);
    expect(page.complete).toBe(true);
  });

  it("searches with every count bound unset", async () => {
    await writeAt("project/a.go", "needle one\n");
    await writeAt("project/b.go", "needle two\n");
    const prefix = join(fixture.root, "project");
    // The finite control stops after one file, so the unset request's second
    // file proves the nulls really remove the bound.
    const bounded = await grep(
      request(prefix, { bounds: { ...BOUNDS, files: 1 } }),
    );
    expect(pathsOf(bounded)).toEqual(["a.go"]);
    expect(bounded.complete).toBe(false);
    const page = await grep(
      request(prefix, {
        bounds: { ...BOUNDS, files: null, entries: null, bytes: null },
      }),
    );
    expect(pathsOf(page)).toEqual(["a.go", "b.go"]);
    expect(page.complete).toBe(true);
  });

  it("refuses a negative or fractional bound", async () => {
    await writeAt("project/a.go", "needle\n");
    const prefix = join(fixture.root, "project");
    const negative = await daemon.attempt(
      FS_GREP_METHOD,
      request(prefix, { bounds: { ...BOUNDS, files: -1 } }),
    );
    expect(negative.error).toMatchObject({ code: "invalid_params" });
    const fractional = await daemon.attempt(
      FS_GREP_METHOD,
      request(prefix, { bounds: { ...BOUNDS, entries: 1.5 } }),
    );
    expect(fractional.error).toMatchObject({ code: "invalid_params" });
  });

  it("resumes after the entry a position cursor names", async () => {
    await writeAt("project/a.md", "nothing here\n");
    await writeAt("project/b.md", "needle\n");
    const prefix = join(fixture.root, "project");
    const first = await grep(
      request(prefix, { bounds: { ...BOUNDS, files: 1 } }),
    );
    expect(pathsOf(first)).toEqual([]);
    expect(first.complete).toBe(false);
    if (first.cursor === undefined)
      throw new Error("the page carries a cursor");
    expect(
      decodeGrepCursor(
        first.cursor,
        fsGrepCursorKey({
          path: prefix,
          patterns: ["needle"],
          literal: false,
          ignoreCase: false,
        }),
      ),
    ).toMatchObject({ kind: "position", rel: "a.md" });

    const second = await grep(request(prefix, { cursor: first.cursor }));
    expect(pathsOf(second)).toEqual(["b.md"]);
    expect(second.complete).toBe(true);
  });

  it("marks the file's twentieth passage and hides the rest", async () => {
    await writeAt("project/a.go", spacedMatches(21));
    const page = await grep(request(join(fixture.root, "project")));
    expect(page.results).toHaveLength(20);
    expect(page.results.filter((passage) => passage.capped === true)).toEqual([
      page.results[19],
    ]);
    expect(page.results[19]).toMatchObject({ truncated: true, capped: true });
  });

  it("marks the twentieth passage of a file that spans pages", async () => {
    await writeAt("project/a.go", spacedMatches(21));
    const prefix = join(fixture.root, "project");
    const whole = await grep(request(prefix));
    // A page that holds ten passages leaves the twentieth to the next page,
    // where a per-page count would lose the mark.
    const split = await grep(
      request(prefix, {
        // Ten passages and the cursor field that names the tenth.
        bounds: {
          ...BOUNDS,
          pageUnits:
            unitsOf(whole.results.slice(0, 10)) +
            grepContinuationUnits({
              scopeIndex: 0,
              rel: "a.go",
              startLine: whole.results[9].startLine,
            }),
        },
      }),
    );
    expect(split.results).toHaveLength(10);
    if (split.cursor === undefined)
      throw new Error("the page carries a cursor");
    const rest = await grep(request(prefix, { cursor: split.cursor }));
    expect(rest.results.at(-1)).toMatchObject({
      startLine: whole.results[19].startLine,
      truncated: true,
      capped: true,
    });
  });

  it("marks a cut passage and continues it on resume", async () => {
    const long = Array.from(
      { length: 8 },
      () => `needle ${"x".repeat(200)}`,
    ).join("\n");
    await writeAt("project/a.go", `${long}\n`);
    const prefix = join(fixture.root, "project");
    const first = await grep(
      request(prefix, {
        // A page that leaves 400 units for the passages themselves.
        bounds: {
          ...BOUNDS,
          pageUnits: pageRoom("a.go", 1, 400),
        },
      }),
    );
    expect(first.results).toHaveLength(1);
    // A cut passage claims the cut only: its file is not capped, so the
    // twentieth-passage marker would be a lie the hub renders back.
    expect(first.results[0]).toMatchObject({
      startLine: 1,
      cut: true,
    });
    expect(first.results[0]).not.toHaveProperty("truncated");
    const cutEnd = first.results[0]?.endLine ?? 0;
    expect(cutEnd).toBeLessThan(8);
    if (first.cursor === undefined)
      throw new Error("the page carries a cursor");
    const rest = await grep(request(prefix, { cursor: first.cursor }));
    expect(rest.results[0]).toMatchObject({ startLine: cutEnd + 1 });
  });

  it("announces a file's size and streams its bytes", async () => {
    await writeAt("exact.md", "0123456789");
    const port = createGrepWalkPort(
      await realpath(fixture.root),
      createRootGuard([fixture.root]),
      undefined,
    );
    const opened = await port.open("exact.md");
    if (!("chunks" in opened)) throw new Error("a regular file opens");
    expect(opened.size).toBe(10);
    expect(await collectChunks(opened.chunks)).toEqual(
      Buffer.from("0123456789"),
    );
  });

  it("refuses a symbolic link at the opened path", async () => {
    await writeAt("real.md", "needle\n");
    await symlink(join(fixture.root, "real.md"), join(fixture.root, "link.md"));
    const port = createGrepWalkPort(
      await realpath(fixture.root),
      createRootGuard([fixture.root]),
      undefined,
    );
    await expect(port.open("link.md")).resolves.toStrictEqual({
      kind: "unreadable",
    });
  });

  it("refuses a FIFO without blocking the walk", async () => {
    await makeFifo(join(fixture.root, "pipe"));
    const port = createGrepWalkPort(
      await realpath(fixture.root),
      createRootGuard([fixture.root]),
      undefined,
    );
    await expect(port.open("pipe")).resolves.toStrictEqual({
      kind: "unreadable",
    });
  });

  it("searches a file larger than the old one-mebibyte cut", async () => {
    await writeAt("project/big.go", `${"x".repeat(2 * 1024 * 1024)}\nneedle\n`);
    const page = await grep(request(join(fixture.root, "project")));
    expect(pathsOf(page)).toEqual(["big.go"]);
    expect(page.warnings).toEqual([]);
  });

  it("applies no rules from an ignore file the walk will not read", async () => {
    const prefix = join(fixture.root, "project");
    await writeAt("project/ignored/b.go", "needle\n");
    await writeAt("project/a.go", "needle\n");
    // A link is never followed, exactly as the walk never follows one.
    await writeAt("rules.txt", "ignored/\n");
    await symlink(join(fixture.root, "rules.txt"), join(prefix, ".gitignore"));
    expect(pathsOf(await grep(request(prefix)))).toEqual([
      "a.go",
      "ignored/b.go",
    ]);
    // A file over the ignore bound applies no rules either.
    await writeAt("project/.gitignore", `ignored/\n${"#".repeat(256 * 1024)}`);
    expect(pathsOf(await grep(request(prefix)))).toEqual([
      "a.go",
      "ignored/b.go",
    ]);
  });

  it("ends a stream with a refusal when its directory is swapped during the read", async () => {
    await writeAt(
      "project/sub/inside.md",
      `${"x".repeat(128 * 1024)}\nneedle\n`,
    );
    const guard = createRootGuard([fixture.root]);
    const guarded = await guard.resolvePath(join(fixture.root, "project"));
    const port = createGrepWalkPort(guarded.canonical, guard, undefined);
    const opened = await port.open("sub/inside.md");
    if (!("chunks" in opened)) throw new Error("a regular file opens");
    const iterator = opened.chunks[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toBeInstanceOf(Uint8Array);
    // The listing named a real directory; the swap lands mid-read.
    await rm(join(fixture.root, "project", "sub"), {
      recursive: true,
      force: true,
    });
    await symlink(fixture.outside, join(fixture.root, "project", "sub"));
    const rest: Array<unknown> = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      rest.push(next.value);
    }
    expect(rest.at(-1)).toStrictEqual({ kind: "unreadable" });
    await opened.close();
  });

  it("drops a subtree swapped for a link outside the roots between list and read", async () => {
    const prefix = join(fixture.root, "project");
    await writeAt("project/sub/inside.md", "plain\n");
    await writeFile(join(fixture.outside, "inside.md"), "needle outside\n");
    const guard = createRootGuard([fixture.root]);
    const guarded = await guard.resolvePath(prefix);
    const port = createGrepWalkPort(guarded.canonical, guard, undefined);
    // The listing is genuine; the swap lands before the engine reads below it.
    let swapped = false;
    const swapping: GrepWalkPort = {
      ...port,
      list: async (rel) => {
        const entries = await port.list(rel);
        if (!swapped && rel === "sub") {
          swapped = true;
          await rm(join(prefix, "sub"), { recursive: true, force: true });
          await symlink(fixture.outside, join(prefix, "sub"));
        }
        return entries;
      },
    };
    const compiled = compileGrepPatterns({
      patterns: ["needle"],
      literal: false,
      ignoreCase: false,
    });
    if (!compiled.ok) throw new Error(compiled.message);
    const scan = await runGrepScan({
      scopes: [
        {
          index: 0,
          locatorPrefix: `${prefix}/`,
          port: swapping,
          glob: undefined,
          singleFile: false,
          locatorFor: (rel) => rel,
        },
      ],
      patterns: compiled.compiled,
      onCandidate: () => Promise.resolve(true),
      budget: ENGINE_BUDGET,
      inputHash: "swapped-subtree",
      now: () => Date.now(),
    });
    expect(swapped).toBe(true);
    expect(scan.results).toEqual([]);
    expect(scan.warnings).toEqual([{ kind: "unreadable", count: 1 }]);
    // A listed name in the swapped tree reaches no file either.
    expect(await port.list("sub")).toEqual([]);
  });

  it("applies no ignore rules from a directory swapped for a link", async () => {
    const prefix = join(fixture.root, "project");
    await writeAt("project/sub/inside.md", "plain\n");
    await writeFile(join(fixture.outside, ".gitignore"), "inside.md\n");
    const guard = createRootGuard([fixture.root]);
    const guarded = await guard.resolvePath(prefix);
    const port = createGrepWalkPort(guarded.canonical, guard, undefined);
    await rm(join(prefix, "sub"), { recursive: true, force: true });
    await symlink(fixture.outside, join(prefix, "sub"));
    if (port.ignoreFiles === undefined)
      throw new Error("the walk reads ignore files");
    expect(await port.ignoreFiles("sub")).toEqual([]);
    expect(await port.list("sub")).toEqual([]);
  });

  it("stops an ignore-file read when the call aborts", async () => {
    const prefix = join(fixture.root, "project");
    await writeAt("project/.gitignore", "x\n");
    const guard = createRootGuard([fixture.root]);
    const guarded = await guard.resolvePath(prefix);
    const controller = new AbortController();
    controller.abort();
    const port = createGrepWalkPort(
      guarded.canonical,
      guard,
      controller.signal,
    );
    if (port.ignoreFiles === undefined)
      throw new Error("the walk reads ignore files");
    await expect(port.ignoreFiles("")).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("reads the resolved prefix when an ancestor link is repointed outside the roots", async () => {
    await writeAt("real/a.md", "needle inside\n");
    await writeFile(join(fixture.outside, "a.md"), "needle outside\n");
    await symlink(join(fixture.root, "real"), join(fixture.root, "alias"));
    const guard = createRootGuard([fixture.root]);
    const guarded = await guard.resolvePath(join(fixture.root, "alias"));
    const port = createGrepWalkPort(guarded.canonical, guard, undefined);
    // The ancestor the request named now points outside every root.
    await rm(join(fixture.root, "alias"));
    await symlink(fixture.outside, join(fixture.root, "alias"));
    const opened = await port.open("a.md");
    if (!("chunks" in opened)) throw new Error("the file is read");
    expect((await collectChunks(opened.chunks)).toString()).toBe(
      "needle inside\n",
    );
  });
});
