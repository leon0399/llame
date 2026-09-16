import * as filesystem from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import type * as Filesystem from "node:fs/promises";
import { readFile, readResolvedFile, MAX_RESULT_CODE_UNITS } from "./read";
import { measureNativeModelOutput } from "./serialization";
import {
  listDirectory,
  DIRECTORY_CHILD_CAP,
  DIRECTORY_TRAVERSAL_BUDGET,
  type DirectoryPort,
} from "./directory-listing";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof Filesystem>();
  return { ...original, opendir: vi.fn(original.opendir) };
});

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

    const opened = vi.spyOn(filesystem, "open");
    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    const lines = result.content.split("\n").filter(Boolean);
    const linkLine = `  - link@/ -> ${await realpath(join(root, "target"))}`;
    expect(lines).toContain(linkLine);
    // The target holds a file the listing would render below the link line
    // had the link been descended; the link line is the last one instead.
    expect(lines.indexOf(linkLine)).toBe(lines.length - 1);
    expect(opened).not.toHaveBeenCalled();
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

  it("names a directory-target link's canonical target and never descends it", async () => {
    const target = await mkdtemp(join(tmpdir(), "native-dir-target-"));
    try {
      await writeFile(join(target, "inside.txt"), "");
      await symlink(target, join(root, "link"));

      // The module mock is shared across this file's tests, so count only the
      // calls this listing makes.
      const opened = vi.spyOn(filesystem, "open").mockClear();
      const looked = vi.spyOn(filesystem, "opendir").mockClear();
      const result = await readFile({ path: root });
      if (result.status !== "success" || result.kind !== "directory")
        throw new Error();
      expect(result.content).toBe(
        `${root}\n  - link@/ -> ${await realpath(target)}\n`,
      );
      expect(opened).not.toHaveBeenCalled();
      expect(looked.mock.calls.map(([path]) => path)).toEqual([root]);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it("names a file-target link's canonical target", async () => {
    await writeFile(join(root, "notes.md"), "");
    await symlink("notes.md", join(root, "alias.md"));

    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toContain(
      `  - alias.md@ -> ${await realpath(join(root, "notes.md"))}`,
    );
  });

  it("resolves a multi-hop link to its final canonical target", async () => {
    await writeFile(join(root, "final.md"), "");
    await symlink(join(root, "final.md"), join(root, "hop-one"));
    await symlink(join(root, "hop-one"), join(root, "hop-two"));

    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    const canonical = await realpath(join(root, "final.md"));
    expect(result.content).toContain(`  - hop-two@ -> ${canonical}`);
    expect(result.content).toContain(`  - hop-one@ -> ${canonical}`);
  });

  it("shows a dangling link's raw link text", async () => {
    await symlink("missing.md", join(root, "broken.md"));

    const result = await readFile({ path: root });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toBe(`${root}\n  - broken.md@? -> missing.md\n`);
  });

  it("keeps a link's line byte-identical when a sibling is added", async () => {
    await writeFile(join(root, "notes.md"), "");
    await symlink("notes.md", join(root, "alias.md"));
    const canonical = await realpath(join(root, "notes.md"));

    const before = await readFile({ path: root });
    await writeFile(join(root, "added.md"), "");
    const after = await readFile({ path: root });
    if (
      before.status !== "success" ||
      before.kind !== "directory" ||
      after.status !== "success" ||
      after.kind !== "directory"
    )
      throw new Error();
    expect(before.content).toBe(
      `${root}\n  - alias.md@ -> ${canonical}\n  - notes.md\n`,
    );
    expect(after.content).toBe(
      `${root}\n  - added.md\n  - alias.md@ -> ${canonical}\n  - notes.md\n`,
    );
  });

  it.runIf(process.platform !== "win32")(
    "shows a link to a special entry with its raw link text and no open",
    async () => {
      await mkdir(join(root, "specials"));
      const fifo = join(root, "specials", "pipe");
      // Node cannot create a FIFO, so the host's own `mkfifo` does; the guard
      // keeps the case off platforms that have neither.
      await promisify(execFile)("mkfifo", [fifo]);
      await symlink("specials/pipe", join(root, "linked-pipe"));

      const opened = vi.spyOn(filesystem, "open").mockClear();
      const result = await readFile({ path: root });
      if (result.status !== "success" || result.kind !== "directory")
        throw new Error();
      expect(result.content).toContain("  - linked-pipe@? -> specials/pipe");
      expect(result.content).toContain("    - pipe?");
      expect(opened).not.toHaveBeenCalled();
    },
  );

  it("renders every link as the bare - name@ when linkTargets is false", async () => {
    await mkdir(join(root, "target"));
    await symlink(join(root, "target"), join(root, "link"));

    const realpathCalls = vi.spyOn(filesystem, "realpath").mockClear();
    const readlinkCalls = vi.spyOn(filesystem, "readlink").mockClear();
    const statCalls = vi.spyOn(filesystem, "stat").mockClear();
    const result = await readResolvedFile(root, {
      displayPath: "kb://space/",
      linkTargets: false,
    });
    if (result.status !== "success" || result.kind !== "directory")
      throw new Error();
    expect(result.content).toBe("kb://space/\n  - target/\n  - link@\n");
    // Withholding the target is what keeps a resolved host path out of the
    // listing, so the listing must not ask the filesystem for one.
    expect(realpathCalls).not.toHaveBeenCalled();
    expect(readlinkCalls).not.toHaveBeenCalled();
    expect(statCalls).not.toHaveBeenCalled();
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

  it("resolves link metadata only for the requested flat slice", async () => {
    const resolved: Array<string> = [];
    const mockPort: DirectoryPort = {
      opendir: () => {
        const entries = ["a", "b", "c", "d"].map((name) => ({
          name,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => true,
        }));
        let idx = 0;
        return Promise.resolve({
          read: () =>
            Promise.resolve(idx < entries.length ? entries[idx++] : null),
          close: () => Promise.resolve(),
        });
      },
      stat: () =>
        Promise.resolve({ isFile: () => true, isDirectory: () => false }),
      realpath: (path) => {
        resolved.push(path);
        return Promise.resolve(`/real${path}`);
      },
      readlink: () => Promise.reject(new Error("unexpected readlink")),
    };

    const result = await listDirectory("/root", mockPort, {
      offset: 1,
      limit: 2,
    });
    if (result.status !== "success") throw new Error();
    expect(resolved).toEqual(["/root/b", "/root/c"]);
    expect(result.content).toBe(
      "/root\n  - b@ -> /real/root/b\n  - c@ -> /real/root/c\n",
    );
  });

  it("bounds a flat listing by the rendered length of its link lines", async () => {
    const names = Array.from({ length: 700 }, (_, i) => `link-${i}`);
    const entries = names.map((name) => ({
      name,
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
    }));
    let idx = 0;
    const mockPort: DirectoryPort = {
      opendir: () =>
        Promise.resolve({
          read: () =>
            Promise.resolve(idx < entries.length ? entries[idx++] : null),
          close: () => Promise.resolve(),
        }),
      stat: () =>
        Promise.resolve({ isFile: () => true, isDirectory: () => false }),
      realpath: (path) =>
        Promise.resolve(`${path}/deeply/nested/canonical/target/path`),
      readlink: () => Promise.reject(new Error("unexpected readlink")),
    };

    const result = await listDirectory("/root", mockPort, {
      offset: 0,
      limit: names.length,
    });
    if (result.status !== "success") throw new Error();
    const rendered = result.content.split("\n").filter(Boolean).length - 1;
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(
      MAX_RESULT_CODE_UNITS,
    );
    // The rendered link lines are what the cap counts, so the listing stops
    // well short of the 700 requested entries and resumes from there.
    expect(result.truncated).toBe(true);
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(names.length);
    expect(result.nextOffset).toBe(rendered);
  });

  it("resolves link metadata only for a child directory's capped head", async () => {
    const names = Array.from(
      { length: DIRECTORY_CHILD_CAP + 5 },
      (_, i) => `s${String(i).padStart(2, "0")}`,
    );
    const resolved: Array<string> = [];
    const childEntries = names.map((name) => ({
      name,
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
    }));
    let rootRead = false;
    const mockPort: DirectoryPort = {
      opendir: () => {
        const entries = rootRead
          ? childEntries
          : [
              {
                name: "bigchild",
                isFile: () => false,
                isDirectory: () => true,
                isSymbolicLink: () => false,
              },
            ];
        rootRead = true;
        let idx = 0;
        return Promise.resolve({
          read: () =>
            Promise.resolve(idx < entries.length ? entries[idx++] : null),
          close: () => Promise.resolve(),
        });
      },
      stat: () =>
        Promise.resolve({ isFile: () => true, isDirectory: () => false }),
      realpath: (path) => {
        resolved.push(path);
        return Promise.resolve(`/real${path}`);
      },
      readlink: () => Promise.reject(new Error("unexpected readlink")),
    };

    const result = await listDirectory("/root", mockPort);
    if (result.status !== "success") throw new Error();
    const capped = names.slice(0, DIRECTORY_CHILD_CAP);
    expect(resolved).toEqual(capped.map((name) => `/root/bigchild/${name}`));
    expect(result.content).toContain("    - s00@ -> /real/root/bigchild/s00\n");
    expect(result.content).not.toContain("s24");
    expect(result.content).toContain("… 5 more");
  });

  it("reads no link metadata for a child over the traversal budget", async () => {
    const count = DIRECTORY_TRAVERSAL_BUDGET + 1;
    const resolved: Array<string> = [];
    let rootRead = false;
    let childIdx = 0;
    const mockPort: DirectoryPort = {
      opendir: () => {
        if (!rootRead) {
          rootRead = true;
          let done = false;
          return Promise.resolve({
            read: () => {
              if (done) return Promise.resolve(null);
              done = true;
              return Promise.resolve({
                name: "bigchild",
                isFile: () => false,
                isDirectory: () => true,
                isSymbolicLink: () => false,
              });
            },
            close: () => Promise.resolve(),
          });
        }
        return Promise.resolve({
          read: () => {
            if (childIdx >= count) return Promise.resolve(null);
            childIdx += 1;
            return Promise.resolve({
              name: `s${childIdx}`,
              isFile: () => false,
              isDirectory: () => false,
              isSymbolicLink: () => true,
            });
          },
          close: () => Promise.resolve(),
        });
      },
      stat: () =>
        Promise.resolve({ isFile: () => true, isDirectory: () => false }),
      realpath: (path) => {
        resolved.push(path);
        return Promise.resolve(`/real${path}`);
      },
      readlink: () => Promise.reject(new Error("unexpected readlink")),
    };

    const result = await listDirectory("/root", mockPort);
    if (result.status !== "success") throw new Error();
    // The block renders only the count, so not even its capped head is read.
    expect(resolved).toEqual([]);
    expect(result.content).toContain(`    … ${count} entries`);
  });

  it("returns directory_too_large for a root over the traversal budget", async () => {
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
      opendir: () =>
        Promise.resolve({
          read: () =>
            Promise.resolve(
              idx < mockEntries.length ? mockEntries[idx++] : null,
            ),
          close: () => Promise.resolve(),
        }),
      stat: () => Promise.reject(new Error("unexpected stat")),
      realpath: () => Promise.reject(new Error("unexpected realpath")),
      readlink: () => Promise.reject(new Error("unexpected readlink")),
    };
    const result = await listDirectory("/fake/path", mockPort);
    expect(result).toMatchObject({
      status: "error",
      type: "directory_too_large",
    });
    if (result.status !== "error") throw new Error();
    expect(result.count).toBe(DIRECTORY_TRAVERSAL_BUDGET + 100);
  });

  it("elides a child over the traversal budget", async () => {
    const bigChildCount = DIRECTORY_TRAVERSAL_BUDGET + 50;
    let rootRead = false;
    let childIdx = 0;
    const mockPort: DirectoryPort = {
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
      stat: () => Promise.reject(new Error("unexpected stat")),
      realpath: () => Promise.reject(new Error("unexpected realpath")),
      readlink: () => Promise.reject(new Error("unexpected readlink")),
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
    const openedPaths: Array<string> = [];
    const mockPort: DirectoryPort = {
      opendir: (path: string) => {
        openedPaths.push(path);
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
      stat: () => Promise.reject(new Error("unexpected stat")),
      realpath: () => Promise.reject(new Error("unexpected realpath")),
      readlink: () => Promise.reject(new Error("unexpected readlink")),
    };
    const result = await listDirectory("/test", mockPort);
    expect(result).toMatchObject({ status: "success" });
    if (result.status !== "success") throw new Error();
    expect(result.content).toContain("  - pipe?");
    expect(openedPaths).toEqual(["/test"]);
  });
});
