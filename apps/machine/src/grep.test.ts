import { mkdir, writeFile } from "node:fs/promises";
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
import { encodeGrepCursor } from "@workspace/native-file-tools";
import { isBoolean } from "@workspace/runtime-safety";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import { envelope, startDaemon, type TestDaemon } from "./testing/harness";

let fixture: RootFixture;
let daemon: TestDaemon;

const BUDGET: FsGrepBudget = {
  files: 5000,
  entries: 20_000,
  bytes: 32 * 1024 * 1024,
  deadlineMs: 30_000,
  limit: 20,
  pageUnits: 15_000,
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
  const { path, startLine, endLine, content, matches, truncated } = value;
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
});
