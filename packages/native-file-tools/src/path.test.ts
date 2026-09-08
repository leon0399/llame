import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySelectorSuffix,
  parsePathScheme,
  resolveReadTarget,
} from "./path";

describe("native read selectors", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-read-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["11-13", "11+3"])("normalizes %s once", async (selector) => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:${selector}`)).toEqual({
      path,
      offset: 10,
      limit: 3,
      raw: false,
    });
  });

  it("prefers an existing literal selector filename", async () => {
    const path = join(directory, "notes:0-3");
    await writeFile(path, "literal");
    expect(await resolveReadTarget(path)).toEqual({
      path,
      offset: 0,
      raw: false,
    });
  });

  it.each([
    "0-1",
    "2-1",
    "1+0",
    "-1-3",
    "1-9007199254740992",
    "9007199254740991+2",
    "raw:1+2",
    "raw:",
  ])("rejects invalid %s", async (selector) => {
    await expect(
      resolveReadTarget(`${directory}/notes:${selector}`),
    ).rejects.toMatchObject({ type: "invalid_selector" });
  });

  it("supports ranged raw without confusing a parent directory name", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:raw:2-3`)).toEqual({
      path,
      offset: 1,
      limit: 2,
      raw: true,
    });
    expect(await resolveReadTarget(`${directory}:raw/notes`)).toEqual({
      path: `${directory}:raw/notes`,
      offset: 0,
      raw: false,
    });
  });

  it("rejects relative paths", async () => {
    await expect(resolveReadTarget("notes")).rejects.toMatchObject({
      type: "invalid_path",
    });
  });

  it("parses a range on a filename containing a raw substring", async () => {
    const path = join(directory, "report:raw-copy");
    await writeFile(path, "source");
    expect(await resolveReadTarget(`${path}:10-20`)).toEqual({
      path,
      offset: 9,
      limit: 11,
      raw: false,
    });
  });

  it("accepts valid nested native paths beyond the Knowledge path limit", async () => {
    const parent = join(
      directory,
      ...Array.from({ length: 8 }, () => "x".repeat(140)),
    );
    await mkdir(parent, { recursive: true });
    const path = join(parent, "source");
    await writeFile(path, "source");
    expect(await resolveReadTarget(path)).toEqual({
      path,
      offset: 0,
      raw: false,
    });
  });
});

describe("native path schemes", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-scheme-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ["kb://space/notes/a.md", "kb", "space/notes/a.md"],
    ["kb://space/notes/a.md:41-53", "kb", "space/notes/a.md:41-53"],
    ["KB://space/", "kb", "space/"],
    ["vault://x", "vault", "x"],
    ["chats+v1://x", "chats+v1", "x"],
  ])("parses %s", (input, scheme, rest) => {
    expect(parsePathScheme(input)).toEqual({ scheme, rest });
  });

  it.each(["/tmp/a.md", "/tmp/weird://name.md", "kb:/space", "://x", "1x://y"])(
    "does not read %s as a scheme",
    (input) => {
      expect(parsePathScheme(input)).toBeUndefined();
    },
  );

  it.each(["kb://space/notes/a.md", "kb://space/a.md:41-53", "vault://x"])(
    "refuses %s as a host path",
    async (input) => {
      await expect(resolveReadTarget(input)).rejects.toMatchObject({
        type: "invalid_path",
      });
    },
  );

  it("keeps an absolute filename containing :// literal", async () => {
    const path = join(directory, "weird://name.md");
    await mkdir(join(directory, "weird:"), { recursive: true });
    await writeFile(path.replace("weird://", "weird:/"), "literal");
    expect(
      await resolveReadTarget(path.replace("weird://", "weird:/")),
    ).toEqual({
      path: path.replace("weird://", "weird:/"),
      offset: 0,
      raw: false,
    });
  });

  it.each([
    [undefined, { offset: 0, raw: false }],
    ["11-13", { offset: 10, limit: 3, raw: false }],
    ["11+3", { offset: 10, limit: 3, raw: false }],
    ["raw", { offset: 0, raw: true }],
    ["raw:1-2", { offset: 0, limit: 2, raw: true }],
  ])("applies the split selector %s", (selector, expected) => {
    expect(applySelectorSuffix("/root/a.md", selector)).toEqual({
      path: "/root/a.md",
      ...expected,
    });
  });

  it.each(["0-1", "2-1", "raw:x", "nonsense"])(
    "rejects the split selector %s",
    (selector) => {
      expect(() => applySelectorSuffix("/root/a.md", selector)).toThrow(
        expect.objectContaining({ type: "invalid_selector" }),
      );
    },
  );
});
