import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FS_GREP_METHOD,
  fsGrepCursorKey,
  isIntegerValue,
  isSerializableRecord,
  isStringValue,
  PATH_NOT_REGISTERED_MESSAGE,
  type FsGrepBudget,
  type FsGrepParams,
  type FsGrepPassage,
  type JsonValue,
  type SerializableValue,
} from "@workspace/machine-protocol";
import {
  compileGrepPatterns,
  decodeGrepCursor,
  encodeGrepCursor,
  grepCursorFieldUnits,
  measureNativeModelOutput,
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

/** The wire budget, and the engine budget the daemon runs it under. */
const BUDGET: FsGrepBudget & GrepBudget = {
  files: 5000,
  entries: 20_000,
  bytes: 32 * 1024 * 1024,
  deadlineMs: 30_000,
  limit: 20,
  pageUnits: 15_000,
  // The hub's own result fields never travel on the daemon's page.
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
  return grepCursorFieldUnits({ scopeIndex: 0, rel, startLine }) + room;
}

/** The page units a run of daemon passages takes, its array brackets included. */
function unitsOf(passages: ReadonlyArray<FsGrepPassage>): number {
  return passages.reduce(
    (total, passage, index) =>
      total +
      // The engine pages a passage as its locator, content, and matches.
      measureNativeModelOutput({
        locator: `${passage.path}:${String(passage.startLine)}-${String(passage.endLine)}`,
        content: passage.content,
        matches: passage.matches,
      }) -
      2 +
      (index === 0 ? 0 : 1),
    2,
  );
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
    budget: BUDGET,
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
  return {
    results: parseList(answer["results"], parsePassage),
    complete,
    warnings: parseList(answer["warnings"], parseWarning),
    consumed: { files, entries, bytes },
    cursor: isStringValue(cursor) ? cursor : undefined,
  };
}

async function grep(params: FsGrepParams): Promise<GrepPage> {
  return parseGrep(await daemon.call(FS_GREP_METHOD, params));
}

function pathsOf(page: GrepPage): ReadonlyArray<string> {
  return page.results.map((passage) => passage.path);
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

  it("continues a page from its own cursor", async () => {
    await writeAt("project/a.go", "needle\n");
    await writeAt("project/b.go", "needle\n");
    const prefix = join(fixture.root, "project");
    const first = await grep(
      request(prefix, { budget: { ...BUDGET, limit: 1 } }),
    );
    expect(pathsOf(first)).toEqual(["a.go"]);
    expect(first.complete).toBe(false);
    if (first.cursor === undefined)
      throw new Error("the page carries a cursor");
    const second = await grep(
      request(prefix, {
        budget: { ...BUDGET, limit: 1 },
        cursor: first.cursor,
      }),
    );
    expect(pathsOf(second)).toEqual(["b.go"]);
    expect(second.complete).toBe(true);
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
        budget: { ...BUDGET, files: 1 },
      }),
    );
    expect(pathsOf(page)).toEqual(["a.go"]);
    expect(page.consumed).toEqual({ files: 1, entries: 2, bytes: 7 });
    expect(page.complete).toBe(false);
    expect(page.warnings).toEqual([{ kind: "file_bound", count: 1 }]);
  });

  it("resumes after the entry a position cursor names", async () => {
    await writeAt("project/a.md", "nothing here\n");
    await writeAt("project/b.md", "needle\n");
    const prefix = join(fixture.root, "project");
    const first = await grep(
      request(prefix, { budget: { ...BUDGET, files: 1 } }),
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
        budget: {
          ...BUDGET,
          pageUnits:
            unitsOf(whole.results.slice(0, 10)) +
            grepCursorFieldUnits({
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
        budget: {
          ...BUDGET,
          pageUnits: pageRoom("a.go", 1, 400),
        },
      }),
    );
    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({
      startLine: 1,
      truncated: true,
      cut: true,
    });
    const cutEnd = first.results[0]?.endLine ?? 0;
    expect(cutEnd).toBeLessThan(8);
    if (first.cursor === undefined)
      throw new Error("the page carries a cursor");
    const rest = await grep(request(prefix, { cursor: first.cursor }));
    expect(rest.results[0]).toMatchObject({ startLine: cutEnd + 1 });
  });

  it("reads a file exactly at the bound and refuses one byte more", async () => {
    await writeAt("exact.md", "0123456789");
    await writeAt("over.md", "0123456789a");
    const port = createGrepWalkPort(
      fixture.root,
      await realpath(fixture.root),
      createRootGuard([fixture.root]),
      undefined,
    );
    const exact = await port.read("exact.md", 10);
    if (!(exact instanceof Uint8Array))
      throw new Error("a file at the bound is read");
    expect(new TextDecoder().decode(exact)).toBe("0123456789");
    expect(await port.read("over.md", 10)).toEqual({ kind: "oversized" });
  });

  it("skips a file over the walk's file bound and counts it", async () => {
    await writeAt("project/big.go", `${"x".repeat(1024 * 1024)}\nneedle\n`);
    const page = await grep(request(join(fixture.root, "project")));
    expect(page.results).toEqual([]);
    expect(page.warnings).toEqual([{ kind: "oversized", count: 1 }]);
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

  it("drops a subtree swapped for a link outside the roots between list and read", async () => {
    const prefix = join(fixture.root, "project");
    await writeAt("project/sub/inside.md", "plain\n");
    await writeFile(join(fixture.outside, "inside.md"), "needle outside\n");
    const guard = createRootGuard([fixture.root]);
    const guarded = await guard.resolvePath(prefix);
    const port = createGrepWalkPort(
      guarded.path,
      guarded.canonical,
      guard,
      undefined,
    );
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
      budget: BUDGET,
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
    const port = createGrepWalkPort(
      guarded.path,
      guarded.canonical,
      guard,
      undefined,
    );
    await rm(join(prefix, "sub"), { recursive: true, force: true });
    await symlink(fixture.outside, join(prefix, "sub"));
    if (port.ignoreFile === undefined)
      throw new Error("the walk reads ignore files");
    expect(await port.ignoreFile("sub")).toBeUndefined();
    expect(await port.list("sub")).toEqual([]);
  });
});
