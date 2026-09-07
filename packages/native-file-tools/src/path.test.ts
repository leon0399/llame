import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveReadTarget } from "./path";

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
