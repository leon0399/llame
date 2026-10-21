import { decodeGrepCursor } from "./cursor";
import type { DecodedGrepCursor } from "./cursor";
import {
  createMemoryPort,
  createSingleFilePort,
  memoryScope,
  runMemoryScan,
} from "./memory-port.test-fixture";
import type { MemoryNode, MemoryTree } from "./memory-port.test-fixture";
import type { GrepScanResult } from "./types";

function file(content: string): MemoryNode {
  return { kind: "file", content };
}

function binary(bytes: Uint8Array): MemoryNode {
  return { kind: "binary", bytes };
}

function directory(children: MemoryTree): MemoryNode {
  return { kind: "directory", children };
}

function hit(): MemoryNode {
  return file("hit\n");
}

function decode(cursor: string | undefined): DecodedGrepCursor {
  if (cursor === undefined) throw new Error("expected a cursor");
  const decoded = decodeGrepCursor(cursor, "input-hash");
  if ("error" in decoded) throw new Error(decoded.error);
  return decoded;
}

function matchingChildren(count: number): MemoryTree {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `f${String(index).padStart(2, "0")}.md`,
      hit(),
    ]),
  );
}

describe("grep walk order and ignore rules", () => {
  function repoTree(): MemoryTree {
    return {
      ".editorconfig": file("root = true\nhit\n"),
      ".env": file("SECRET=hit\n"),
      ".gitignore": file("node_modules/\ndist/\n"),
      ".git": directory({ config: hit() }),
      dist: directory({ "app.js": hit() }),
      node_modules: directory({ "dep.js": hit() }),
      src: directory({
        "a.ts": file("hit one\nplain\n"),
        nested: directory({ "b.ts": file("hit two\n") }),
      }),
      link: { kind: "link" },
    };
  }

  it("visits files in byte order, depth first, and honors .gitignore", async () => {
    const port = createMemoryPort(repoTree());
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/.editorconfig:1-2",
      "/repo/.env:1-1",
      "/repo/src/a.ts:1-2",
      "/repo/src/nested/b.ts:1-1",
    ]);
    expect(port.reads).toEqual([
      ".editorconfig",
      ".env",
      "src/a.ts",
      "src/nested/b.ts",
    ]);
    expect(port.lists).not.toContain("node_modules");
    expect(port.lists).not.toContain("dist");
    expect(port.lists).not.toContain(".git");
    expect(result.warnings).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("orders names by UTF-8 bytes, not UTF-16 code units", async () => {
    const port = createMemoryPort({ "😀.md": hit(), "～.md": hit() });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/～.md:1-1",
      "/repo/😀.md:1-1",
    ]);
  });

  it("counts a link the skill port reports and searches past it", async () => {
    const port = createMemoryPort(
      {
        "a.md": hit(),
        loop: { kind: "link", identity: "pkg" },
        "z.md": hit(),
      },
      true,
    );
    const result = await runMemoryScan(
      [memoryScope(0, "/pkg/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/pkg/a.md:1-1",
      "/pkg/z.md:1-1",
    ]);
    expect(result.warnings).toEqual([{ kind: "link", count: 1 }]);
  });

  it("skips a skill directory whose identity is already on the path", async () => {
    const port = createMemoryPort(
      {
        pkg: {
          kind: "directory",
          identity: "pkg",
          children: {
            "deep.md": hit(),
            loop: {
              kind: "directory",
              identity: "pkg",
              children: { "x.md": hit() },
            },
          },
        },
      },
      true,
    );
    const result = await runMemoryScan(
      [memoryScope(0, "/pkg/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/pkg/pkg/deep.md:1-1",
    ]);
    expect(result.warnings).toEqual([{ kind: "link", count: 1 }]);
  });

  it("searches an exact gitignored file through a single-file scope", async () => {
    const port = createSingleFilePort(hit(), "app.js\n");
    const result = await runMemoryScan(
      [
        memoryScope(0, "/repo/dist/app.js", port, {
          singleFile: true,
        }),
      ],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/dist/app.js:1-1",
    ]);
    expect(port.lists).toEqual([]);
    expect(port.reads).toEqual([""]);
  });

  it("searches only glob candidates and prunes directories that cannot match", async () => {
    const port = createMemoryPort({
      "a.md": hit(),
      "b.txt": hit(),
      sub: directory({ "c.md": hit(), "d.txt": hit() }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port, { glob: "*.md" })],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    expect(port.lists).not.toContain("sub");
  });

  it("orders passages by submitted scope index", async () => {
    const first = createMemoryPort({ "b.md": hit() });
    const second = createMemoryPort({ "a.md": hit() });
    const result = await runMemoryScan(
      [memoryScope(1, "/later/", first), memoryScope(0, "/first/", second)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/first/a.md:1-1",
      "/later/b.md:1-1",
    ]);
  });

  it("encodes glob characters in a knowledge locator", async () => {
    const port = createMemoryPort({
      "a*.md": file("line1\nline2\nhit\nline4\n"),
    });
    const result = await runMemoryScan(
      [
        memoryScope(0, "kb://space/notes/", port, {
          locatorFor: (rel) =>
            `kb://space/notes/${rel.replaceAll("*", "%2A").replaceAll("?", "%3F")}`,
        }),
      ],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "kb://space/notes/a%2A.md:2-4",
    ]);
    expect(result.results[0].matches).toEqual([3]);
  });
});

describe("grep walk bounds", () => {
  it("skips and counts a binary file", async () => {
    const port = createMemoryPort({
      "bin.md": binary(Uint8Array.of(0x68, 0x69, 0x74, 0x00)),
      "txt.md": hit(),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/txt.md:1-1",
    ]);
    expect(result.warnings).toEqual([{ kind: "binary", count: 1 }]);
  });

  it("skips and counts a file that is not UTF-8", async () => {
    const port = createMemoryPort({
      "bad.md": binary(Uint8Array.of(0xff, 0xfe)),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "invalid_utf8", count: 1 }]);
  });

  it("skips and counts an oversized or unreadable file", async () => {
    const port = createMemoryPort({
      "big.md": { kind: "file", content: "", refusal: "oversized" },
      "locked.md": { kind: "file", content: "", refusal: "unreadable" },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.warnings).toEqual([
      { kind: "oversized", count: 1 },
      { kind: "unreadable", count: 1 },
    ]);
  });

  it("stops at the file bound with a cursor", async () => {
    const port = createMemoryPort({
      "a.md": hit(),
      "b.md": hit(),
      "c.md": hit(),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { files: 2 },
      },
    );
    expect(result.results).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([{ kind: "file_bound", count: 1 }]);
    expect(decode(result.cursor).rel).toBe("b.md");
  });

  it("stops at the entry bound", async () => {
    const port = createMemoryPort({
      "a.md": hit(),
      "b.md": hit(),
      "c.md": hit(),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { entries: 1 },
      },
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    expect(result.warnings).toEqual([{ kind: "entry_bound", count: 1 }]);
    expect(result.complete).toBe(false);
  });

  it("stops at the byte bound before opening a file", async () => {
    const port = createMemoryPort({ "a.md": hit() });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { bytes: 0 },
      },
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "byte_bound", count: 1 }]);
    expect(result.cursor).toBeUndefined();
    expect(port.reads).toEqual([]);
  });

  it("returns a partial page with a cursor at the deadline", async () => {
    const port = createMemoryPort({
      "a.md": hit(),
      "b.md": hit(),
      "c.md": hit(),
    });
    let clock = 0;
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { deadlineMs: 2500 },
        now: () => (clock += 1000),
      },
    );
    expect(result.results).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([{ kind: "deadline", count: 1 }]);
    expect(decode(result.cursor).rel).toBe("b.md");
  });
});

describe("grep paging", () => {
  it("resumes after the cursor without repeating a file", async () => {
    const port = createMemoryPort(matchingChildren(25));
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"]);
    expect(first.results).toHaveLength(20);
    expect(first.complete).toBe(false);
    const openedBefore = port.reads.length;
    const second = await runMemoryScan([scope], ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results).toHaveLength(5);
    expect(second.complete).toBe(true);
    expect(second.cursor).toBeUndefined();
    const repeated = first.results.filter((passage) =>
      second.results.some((other) => other.locator === passage.locator),
    );
    expect(repeated).toEqual([]);
    // Only the file the cursor names and later files are opened.
    expect(port.reads.slice(openedBefore)).toEqual([
      "f19.md",
      "f20.md",
      "f21.md",
      "f22.md",
      "f23.md",
      "f24.md",
    ]);
  });

  it("marks the twentieth passage and resumes at the next file", async () => {
    const text = Array.from({ length: 130 }, (_, index) =>
      (index + 1) % 5 === 1 ? "hit" : "x",
    ).join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`), "b.md": hit() });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { limit: 1 },
    });
    expect(first.results).toHaveLength(20);
    expect(first.results[19]).toMatchObject({
      locator: "/repo/a.md:95-97",
      truncated: true,
    });
    const cursor = decode(first.cursor);
    expect(cursor).toMatchObject({ rel: "a.md", truncated: true });
    const second = await runMemoryScan([scope], ["hit"], { cursor });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/b.md:1-1",
    ]);
  });

  it("ends the page before the unit budget", async () => {
    const text = Array.from({ length: 26 }, (_, index) =>
      (index + 1) % 5 === 1 ? "hit" : "x",
    ).join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`) });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { pageUnits: 200 },
    });
    expect(first.results).toHaveLength(2);
    expect(first.complete).toBe(false);
    const second = await runMemoryScan([scope], ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results).toHaveLength(4);
    expect(second.complete).toBe(true);
  });

  it("cuts a first passage that does not fit at a line boundary", async () => {
    const text = Array.from({ length: 30 }, () => "hit").join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`) });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { pageUnits: 150 },
      },
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].truncated).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.results[0].locator).not.toBe("/repo/a.md:1-30");
    expect(result.cursor).toBeDefined();
  });

  it("returns an empty complete result when nothing matches", async () => {
    const port = createMemoryPort({
      "bin.md": binary(Uint8Array.of(0x00)),
      "a.md": file("nothing here\n"),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([{ kind: "binary", count: 1 }]);
  });
});

describe("grep read admission", () => {
  it("lists but does not open a file the read group refuses", async () => {
    const port = createMemoryPort({
      "a.md": hit(),
      ".env": file("SECRET=hit\n"),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        onCandidate: (locator) => Promise.resolve(!locator.endsWith("/.env")),
      },
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    expect(result.readRefused).toBe(1);
    expect(port.reads).toEqual(["a.md"]);
  });

  it("reports consumed files, entries, and bytes", async () => {
    const port = createMemoryPort({ "a.md": hit(), "b.md": file("miss\n") });
    const result: GrepScanResult = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.consumed).toEqual({ files: 2, entries: 2, bytes: 9 });
  });
});
