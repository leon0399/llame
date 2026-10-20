import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRoot, readRoots, removeRoot, RootsFileError } from "./roots";
import { createRootFixture, type RootFixture } from "./testing/fixtures";

let fixture: RootFixture;
let file: string;

beforeEach(async () => {
  fixture = await createRootFixture();
  file = join(fixture.base, "llame-machine", "roots.json");
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("roots file", () => {
  it("reads no roots when the file is not there yet", () => {
    expect(readRoots(file)).toEqual([]);
  });

  it("round-trips added roots through the file, canonically", async () => {
    const link = join(fixture.base, "link-dir");
    await symlink(fixture.root, link);
    expect(addRoot(file, link)).toBe(fixture.root);
    expect(addRoot(file, fixture.root)).toBe(fixture.root);
    expect(readRoots(file)).toEqual([fixture.root]);
    await expect(readFile(file, "utf8")).resolves.toBe(
      `${JSON.stringify({ roots: [fixture.root] }, null, 2)}\n`,
    );
    expect(removeRoot(file, link)).toBe(fixture.root);
    expect(readRoots(file)).toEqual([]);
  });

  it("removes one root and keeps the rest", () => {
    addRoot(file, fixture.root);
    addRoot(file, fixture.outside);
    expect(readRoots(file)).toEqual([fixture.root, fixture.outside]);
    removeRoot(file, fixture.root);
    expect(readRoots(file)).toEqual([fixture.outside]);
  });

  it("refuses a directory that does not exist", () => {
    expect(() => addRoot(file, join(fixture.base, "absent"))).toThrow(
      RootsFileError,
    );
  });

  it("refuses a file as a root", async () => {
    await mkdir(join(fixture.base, "dir"));
    const plain = join(fixture.base, "plain.txt");
    await writeFile(plain, "x");
    expect(() => addRoot(file, plain)).toThrow("Not a directory");
  });

  it("refuses to remove a root that is not registered", () => {
    expect(() => removeRoot(file, fixture.root)).toThrow(
      "Root is not registered",
    );
  });

  it("refuses a file that is not JSON", async () => {
    await mkdir(join(fixture.base, "llame-machine"), { recursive: true });
    await writeFile(file, "not json");
    expect(() => readRoots(file)).toThrow("not valid JSON");
  });

  it("refuses a document without absolute root strings", async () => {
    await mkdir(join(fixture.base, "llame-machine"), { recursive: true });
    await writeFile(file, JSON.stringify({ roots: ["relative"] }));
    expect(() => readRoots(file)).toThrow("must hold");
    await writeFile(file, JSON.stringify([]));
    expect(() => readRoots(file)).toThrow("must hold");
  });

  it("leaves the previous file untouched when its write fails", async () => {
    addRoot(file, fixture.root);
    // The temporary is a path the write itself picks; a directory there makes
    // the write fail without needing an unwritable parent.
    await mkdir(`${file}.${process.pid}.tmp`);
    expect(() => addRoot(file, fixture.outside)).toThrow(/EISDIR|EEXIST/u);
    await expect(readFile(file, "utf8")).resolves.toContain(fixture.root);
  });
});
