import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { statHostPath } from "./stat";

describe("host path stat", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-stat-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reports a regular file with its size and canonical path", async () => {
    const path = join(directory, "file.txt");
    await writeFile(path, "hello");

    expect(await statHostPath(path)).toEqual({
      kind: "file",
      size: 5,
      canonicalPath: await realpath(path),
    });
  });

  it("reports a directory", async () => {
    const path = join(directory, "nested");
    await mkdir(path);
    const probe = await statHostPath(path);

    expect(probe).toMatchObject({
      kind: "directory",
      canonicalPath: await realpath(path),
    });
  });

  it("reports a missing path", async () => {
    expect(await statHostPath(join(directory, "absent.md"))).toEqual({
      kind: "missing",
    });
  });

  it("follows a symlink to its target's size and canonical path", async () => {
    const target = join(directory, "target.md");
    await writeFile(target, "# Rules\n");
    const link = join(directory, "AGENTS.md");
    await symlink(target, link);

    expect(await statHostPath(link)).toEqual({
      kind: "file",
      size: 8,
      canonicalPath: await realpath(target),
    });
  });

  it("reports a dangling symlink as missing", async () => {
    const link = join(directory, "AGENTS.md");
    await symlink(join(directory, "absent.md"), link);

    expect(await statHostPath(link)).toEqual({ kind: "missing" });
  });
});
