import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "./read";
import {
  listDirectory,
  DIRECTORY_TRAVERSAL_BUDGET,
  type DirectoryPort,
} from "./directory-listing";

describe("directory listing", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "native-dir-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists two levels with directories before files", async () => {
    await mkdir(join(root, "beta"));
    await mkdir(join(root, "alpha"));
    await writeFile(join(root, "notes.md"), "");
    await writeFile(join(root, "alpha", "deep.txt"), "");
    await writeFile(join(root, "beta", "other.txt"), "");

    const result = await readFile({ path: root });
    expect(result).toMatchObject({
      status: "success",
      kind: "directory",
      path: root,
    });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    const lines = result.content.split("\n").filter(Boolean);
    expect(lines[0]).toBe(root);
    expect(lines[1]).toBe("  - alpha/");
    expect(lines[2]).toBe("    - deep.txt");
    expect(lines[3]).toBe("  - beta/");
    expect(lines[4]).toBe("    - other.txt");
    expect(lines[5]).toBe("  - notes.md");
  });

  it("counts grandchildren without rendering them", async () => {
    await mkdir(join(root, "parent"));
    await mkdir(join(root, "parent", "child"));
    await writeFile(join(root, "parent", "child", "leaf.txt"), "");

    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toContain("  - parent/");
    expect(result.content).toContain("    - child/");
    expect(result.content).not.toContain("leaf.txt");
  });

  it("marks symbolic links with @ and never descends them", async () => {
    await mkdir(join(root, "target"));
    await writeFile(join(root, "target", "inside.txt"), "");
    await symlink(join(root, "target"), join(root, "link"));

    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toContain("  - link@");
    const lines = result.content.split("\n");
    const linkIdx = lines.findIndex((l) => l.includes("link@"));
    expect(linkIdx).toBeGreaterThan(0);
    const nextLine = lines[linkIdx + 1];
    expect(nextLine).not.toMatch(/^\s{4}/);
  });

  it("follows a symbolic link given as the target path", async () => {
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "file.txt"), "");
    await symlink(join(root, "real"), join(root, "symdir"));

    const result = await readFile({ path: join(root, "symdir") });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.path).toBe(join(root, "symdir"));
    expect(result.content).toContain("file.txt");
  });

  it("returns (empty directory) for an empty root", async () => {
    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toBe(`${root}\n(empty directory)\n`);
  });

  it("produces byte-identical output across two reads", async () => {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "file.md"), "");
    await writeFile(join(root, "sub", "nested.txt"), "");

    const first = await readFile({ path: root });
    const second = await readFile({ path: root });
    expect(first).toEqual(second);
  });

  it("caps child directories at 20 entries with … N more", async () => {
    await mkdir(join(root, "big"));
    for (let i = 0; i < 25; i += 1) {
      await writeFile(
        join(root, "big", `file${String(i).padStart(3, "0")}.txt`),
        "",
      );
    }
    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toContain("… 5 more");
    const childLines = result.content
      .split("\n")
      .filter((l) => l.startsWith("    - "));
    expect(childLines).toHaveLength(20);
  });

  it("returns directory_too_large for a root over the traversal budget", async () => {
    // uses static import at top of file
    const mockEntries: Array<{
      name: string;
      isFile: () => boolean;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
    }> = [];
    for (let i = 0; i < DIRECTORY_TRAVERSAL_BUDGET + 100; i += 1) {
      mockEntries.push({
        name: `f${i}`,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      });
    }
    let idx = 0;
    const mockPort: DirectoryPort = {
      lstat: () => Promise.resolve({ isDirectory: () => true }),
      opendir: () =>
        Promise.resolve({
          read: () =>
            Promise.resolve(
              idx < mockEntries.length ? mockEntries[idx++] : null,
            ),
          close: () => Promise.resolve(),
        }),
    };
    const result = await listDirectory("/fake/path", mockPort);
    expect(result).toMatchObject({
      status: "error",
      type: "directory_too_large",
    });
    if (result.status !== "error") throw new Error();
    // SAFETY: narrowed by status check above
    expect((result as { count: number }).count).toBe(
      DIRECTORY_TRAVERSAL_BUDGET + 100,
    );
  });

  it("elides a child over the traversal budget", async () => {
    // uses static import at top of file
    const bigChildCount = DIRECTORY_TRAVERSAL_BUDGET + 50;
    let rootRead = false;
    let childIdx = 0;
    const mockPort: DirectoryPort = {
      lstat: () => Promise.resolve({ isDirectory: () => true }),
      opendir: (_path: string) => {
        if (!rootRead) {
          rootRead = true;
          const entry = {
            name: "bigchild",
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          };
          let done = false;
          return Promise.resolve({
            read: () => {
              if (done) return Promise.resolve(null);
              done = true;
              return Promise.resolve(entry);
            },
            close: () => Promise.resolve(),
          });
        }
        return Promise.resolve({
          read: () => {
            if (childIdx >= bigChildCount) return Promise.resolve(null);
            childIdx += 1;
            return Promise.resolve({
              name: `f${childIdx}`,
              isFile: () => true,
              isDirectory: () => false,
              isSymbolicLink: () => false,
            });
          },
          close: () => Promise.resolve(),
        });
      },
    };
    const result = await listDirectory("/fake", mockPort);
    expect(result).toMatchObject({ status: "success", kind: "directory" });
    if (result.status !== "success") throw new Error();
    expect(result.content).toContain(`… ${bigChildCount} entries`);
    expect(result.content).not.toContain("- f1");
  });

  it("renders an empty child as a bare - name/ line", async () => {
    await mkdir(join(root, "empty-child"));
    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    const lines = result.content.split("\n").filter(Boolean);
    expect(lines).toContain("  - empty-child/");
    const childContentLines = lines.filter((l) => l.startsWith("    "));
    expect(childContentLines).toHaveLength(0);
  });

  it("rejects :raw selector on a directory", async () => {
    const result = await readFile({ path: `${root}:raw` });
    expect(result).toMatchObject({
      status: "error",
      type: "invalid_selector",
    });
  });

  it("accepts trailing separator on a directory", async () => {
    const result = await readFile({ path: `${root}/` });
    expect(result).toMatchObject({
      status: "success",
      kind: "directory",
    });
  });

  it("returns not_found for a trailing separator on a file", async () => {
    await writeFile(join(root, "file.txt"), "content");
    const result = await readFile({ path: `${join(root, "file.txt")}/` });
    expect(result).toMatchObject({
      status: "error",
      type: "not_found",
    });
  });

  it("returns a flat listing with a range selector", async () => {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "a.txt"), "");
    await writeFile(join(root, "b.txt"), "");
    await writeFile(join(root, "c.txt"), "");

    const result = await readFile({ path: `${root}:1-2` });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    const lines = result.content.split("\n").filter(Boolean);
    expect(lines[0]).toBe(root);
    expect(lines).toHaveLength(3);
    const childLines = lines.filter((l) => l.startsWith("    "));
    expect(childLines).toHaveLength(0);
  });

  it("marks special entries with ? and never opens them", async () => {
    // uses static import at top of file
    const mockPort: DirectoryPort = {
      lstat: () => Promise.resolve({ isDirectory: () => true }),
      opendir: () => {
        const entries = [
          {
            name: "pipe",
            isFile: () => false,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ];
        let idx = 0;
        return Promise.resolve({
          read: () =>
            Promise.resolve(idx < entries.length ? entries[idx++] : null),
          close: () => Promise.resolve(),
        });
      },
    };
    const result = await listDirectory("/test", mockPort);
    expect(result).toMatchObject({ status: "success" });
    if (result.status !== "success") throw new Error();
    expect(result.content).toContain("  - pipe?");
  });
});
