import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectAncestorIgnoreFiles } from "./ignore-files";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "llame-ignore-files-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function writeAt(relative: string, text: string): Promise<void> {
  const target = join(base, ...relative.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, text);
}

/** The reader the ports pass: one file of one absolute directory. */
async function read(
  directory: string,
  name: string,
): Promise<string | undefined> {
  try {
    return await readFile(join(directory, name), "utf8");
  } catch {
    return undefined;
  }
}

describe("collectAncestorIgnoreFiles", () => {
  it("reads .ignore everywhere and .gitignore from the repository down", async () => {
    await writeAt("repo/.git/config", "");
    await writeAt(".ignore", "top\n");
    await writeAt(".gitignore", "outside\n");
    await writeAt("repo/.gitignore", "repo\n");
    await writeAt("repo/.ignore", "pair\n");
    const files = await collectAncestorIgnoreFiles(
      {
        prefix: join(base, "repo/sub"),
        root: base,
        fallbackRepository: undefined,
      },
      read,
    );
    expect(files).toEqual([
      { above: "repo/sub/", text: "top\n" },
      { above: "sub/", text: "repo\n" },
      { above: "sub/", text: "pair\n" },
    ]);
  });

  it("takes the fallback as the repository when none is above", async () => {
    await writeAt(".gitignore", "root\n");
    await writeAt(".ignore", "all\n");
    const files = await collectAncestorIgnoreFiles(
      { prefix: join(base, "project"), root: base, fallbackRepository: base },
      read,
    );
    expect(files).toEqual([
      { above: "project/", text: "root\n" },
      { above: "project/", text: "all\n" },
    ]);
  });

  it("stops at an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectAncestorIgnoreFiles(
        {
          prefix: join(base, "a/b"),
          root: base,
          fallbackRepository: undefined,
          signal: controller.signal,
        },
        read,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
