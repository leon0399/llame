import {
  grepIgnoredUnits,
  grepPassageUnits,
  measureGrepRendering,
  renderGrepText,
} from "./model-text";

import { decodeGrepCursor, grepContinuationUnits } from "./cursor";
import type { DecodedGrepCursor, GrepPassageCursor } from "./cursor";
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

function passageCursor(cursor: string | undefined): GrepPassageCursor {
  const decoded = decode(cursor);
  if (decoded.kind !== "passage") throw new Error("expected a passage cursor");
  return decoded;
}

/** A page bound that leaves `room` units for passages beside the page's own. */
function reservedRoom(rel: string, room: number): number {
  return grepContinuationUnits({ scopeIndex: 0, rel, startLine: 1 }) + room;
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

  it("repeats the file line when an overlapping later scope yields the same file", async () => {
    const tree = createMemoryPort({ "app.js": file("hit\nplain\nhit\n") });
    const single = createSingleFilePort(file("hit\nplain\nhit\n"));
    const result = await runMemoryScan(
      [
        memoryScope(0, "/repo/dist/", tree),
        memoryScope(1, "/repo/dist/app.js", single, { singleFile: true }),
      ],
      ["hit"],
    );
    // Both scopes yield the same file and the same lines, so the later run
    // starts a new file line instead of merging under the first.
    expect(renderGrepText({ results: result.results, complete: true })).toBe(
      [
        "## /repo/dist/app.js",
        "*1: hit",
        "2: plain",
        "*3: hit",
        "## /repo/dist/app.js",
        "*1: hit",
        "2: plain",
        "*3: hit",
      ].join("\n"),
    );
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

  it("matches ignore rules case-sensitively like Git", async () => {
    const port = createMemoryPort({
      ".gitignore": file("*.LOG\n"),
      "x.log": hit(),
      "y.LOG": hit(),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/x.log:1-1",
    ]);
  });

  it("keeps the other rules under a directory a deeper layer re-included", async () => {
    const port = createMemoryPort({
      ".gitignore": file("build/\n*.log\n"),
      sub: directory({
        ".gitignore": file("!build/\n"),
        build: directory({ "keep.js": hit(), "noise.log": hit() }),
      }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/sub/build/keep.js:1-1",
    ]);
    expect(result.complete).toBe(true);
  });

  it("searches an explicitly scoped directory an ignore file excludes", async () => {
    const port = createMemoryPort({ "index.js": hit() }, false, [
      { above: "node_modules/react/", text: "node_modules/\n" },
    ]);
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/node_modules/react/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/node_modules/react/index.js:1-1",
    ]);
  });

  it("does not let a glob override an ignore rule", async () => {
    const port = createMemoryPort({
      ".gitignore": file("node_modules/\n"),
      node_modules: directory({ react: directory({ "index.js": hit() }) }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port, { glob: "**/node_modules/react/*.js" })],
      ["hit"],
    );
    expect(result.results).toEqual([]);
  });

  it("excludes a nested ignored directory below an explicit scope", async () => {
    const port = createMemoryPort(
      {
        "index.js": hit(),
        x: directory({ node_modules: directory({ "dep.js": hit() }) }),
      },
      false,
      [{ above: "node_modules/react/", text: "node_modules/\n" }],
    );
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/node_modules/react/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/node_modules/react/index.js:1-1",
    ]);
  });

  it("keeps the files an allow list admits", async () => {
    const port = createMemoryPort({
      ".gitignore": file("*\n!*/\n!src/**\n"),
      lib: directory({ "c.js": hit() }),
      src: directory({ a: directory({ "b.js": hit() }) }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/src/a/b.js:1-1",
    ]);
  });

  it("keeps a negated directory's own files under the rule that matched them", async () => {
    const port = createMemoryPort({
      ".gitignore": file("build*\n!build-tools/\n"),
      "build-tools": directory({ "build.sh": hit(), "tool.js": hit() }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/build-tools/tool.js:1-1",
    ]);
  });

  it("excludes a file an ignore rule matches directly", async () => {
    const port = createMemoryPort({
      ".gitignore": file("docs/**\n!docs/keep/\n"),
      docs: directory({
        "top.md": hit(),
        keep: directory({ "a.md": hit() }),
      }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
  });

  it("reads .ignore after .gitignore and keeps both out of the candidates", async () => {
    const port = createMemoryPort({
      ".gitignore": file("build/\n"),
      ".ignore": file("!build/\nhit\n"),
      build: directory({ "app.js": hit() }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/build/app.js:1-1",
    ]);
  });

  it("applies an anchored rule above the prefix relative to its own directory", async () => {
    const port = createMemoryPort(
      {
        "index.js": hit(),
        lib: directory({ "a.js": hit() }),
      },
      false,
      [{ above: "node_modules/react/", text: "/lib\n" }],
    );
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/node_modules/react/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/node_modules/react/index.js:1-1",
      "/repo/node_modules/react/lib/a.js:1-1",
    ]);
  });

  it("applies an ignore file above the prefix", async () => {
    const port = createMemoryPort({ "a.md": hit(), "b.md": hit() }, false, [
      { above: "apps/", text: "b.md\n" },
    ]);
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/apps/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/apps/a.md:1-1",
    ]);
  });
});

describe("grep excluded-directory report", () => {
  it("reports the excluded directory a later scope can search", async () => {
    const port = createMemoryPort({
      ".gitignore": file("node_modules/\n"),
      node_modules: directory({ "dep.js": hit() }),
      "src.js": hit(),
    });
    const first = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(first.ignored).toEqual({
      paths: ["/repo/node_modules"],
      atLeast: false,
    });
    const nodeModules = createMemoryPort({
      "dep.js": hit(),
    });
    const second = await runMemoryScan(
      [memoryScope(0, "/repo/node_modules/", nodeModules)],
      ["hit"],
    );
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/node_modules/dep.js:1-1",
    ]);
  });

  it("counts a nested excluded directory once", async () => {
    const port = createMemoryPort({
      ".gitignore": file("node_modules/\n"),
      node_modules: directory({
        node_modules: directory({ "dep.js": hit() }),
      }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.ignored?.paths).toEqual(["/repo/node_modules"]);
  });

  it("does not report an exclusion before the resume point", async () => {
    const port = createMemoryPort({
      ".gitignore": file("a/\n"),
      a: directory({ "noise.md": hit() }),
      b: directory({ "b.md": file("plain\n") }),
      c: directory({ "c.md": hit() }),
    });
    const first = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { entries: 2, files: null, bytes: null } },
    );
    expect(first.ignored?.paths).toEqual(["/repo/a"]);
    const cursor = decode(first.cursor);
    expect(cursor.kind).toBe("position");
    const second = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { cursor },
    );
    expect(second.ignored).toBeUndefined();
  });

  it("keeps the ignored line's room back from the next passage", async () => {
    const expected = {
      locator: "/repo/b.md:1-1",
      content: "1: hit",
      matches: [1],
    };
    const ignored = { count: 1, locators: ["/repo/a"], atLeast: false };
    const fixedReserve = 5;
    const pageUnits =
      Math.max(
        grepContinuationUnits({ scopeIndex: 0, rel: ".gitignore" }),
        grepContinuationUnits({ scopeIndex: 0, rel: "a" }),
        grepContinuationUnits({ scopeIndex: 0, rel: "b.md", startLine: 1 }),
      ) +
      grepPassageUnits(undefined, expected) +
      grepIgnoredUnits(ignored) +
      fixedReserve -
      1;
    const excluded = createMemoryPort({
      ".gitignore": file("a/\n"),
      a: directory({}),
      "b.md": hit(),
    });
    const reserved = await runMemoryScan(
      [memoryScope(0, "/repo/", excluded)],
      ["hit"],
      { budget: { pageUnits, fixedReserve } },
    );
    expect(reserved.ignored?.paths).toEqual(["/repo/a"]);
    expect(reserved.results).toEqual([{ ...expected, cut: true }]);
    const control = await runMemoryScan(
      [memoryScope(0, "/repo/", createMemoryPort({ "b.md": hit() }))],
      ["hit"],
      { budget: { pageUnits, fixedReserve } },
    );
    expect(control.results).toEqual([expected]);
  });

  it("ends the page before an exclusion whose line no longer fits", async () => {
    const inputHash = "a".repeat(64);
    const ignoredUnits = grepIgnoredUnits({
      count: 1,
      locators: ["/repo/node_modules"],
      atLeast: false,
    });
    const continuation = grepContinuationUnits({
      scopeIndex: 0,
      rel: "a.md",
      startLine: 1,
    });
    const room = 15_000 - continuation;
    const line = (width: number): string => "a".repeat(width);
    const passageOf = (widthsOf: ReadonlyArray<number>) => ({
      locator: `/repo/a.md:1-${widthsOf.length}`,
      content: widthsOf
        .map((width, index) => `${String(index + 1)}: ${line(width)}`)
        .join("\n"),
      matches: widthsOf.map((_, index) => index + 1),
    });
    const unitsOfLines = (count: number): number =>
      grepPassageUnits(
        undefined,
        passageOf(Array.from({ length: count }, () => 20)),
      );
    let low = 1;
    let high = 2000;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (unitsOfLines(middle) <= room) low = middle;
      else high = middle - 1;
    }
    const widths = Array.from({ length: low }, () => 20);
    let units = unitsOfLines(low);
    widths[widths.length - 1] += room - units;
    units = grepPassageUnits(undefined, passageOf(widths));
    expect(units).toBe(room);
    const tree = createMemoryPort({
      ".gitignore": file("node_modules/\n"),
      "a.md": file(`${widths.map(line).join("\n")}\n`),
      node_modules: directory({ "dep.js": hit() }),
    });
    const first = await runMemoryScan([memoryScope(0, "/repo/", tree)], ["a"], {
      literal: true,
      inputHash,
      budget: { pageUnits: 15_000, fixedReserve: 0 },
    });
    expect(first.results.map((passage) => passage.locator)).toEqual([
      `/repo/a.md:1-${widths.length}`,
    ]);
    expect(first.ignored).toBeUndefined();
    expect(first.complete).toBe(false);
    expect(measureGrepRendering({ ...first })).toBeLessThanOrEqual(15_000);
    const decoded = decodeGrepCursor(first.cursor ?? "", inputHash);
    if ("error" in decoded) throw new Error(decoded.error);
    const second = await runMemoryScan(
      [memoryScope(0, "/repo/", tree)],
      ["a"],
      {
        literal: true,
        inputHash,
        cursor: decoded,
        budget: { pageUnits: 15_000, fixedReserve: 0 },
      },
    );
    expect(second.ignored?.paths).toEqual(["/repo/node_modules"]);
    expect(second.complete).toBe(true);
    expect(ignoredUnits + room + continuation).toBeGreaterThan(15_000);
  });

  it("marks the count a lower bound after one thousand directories", async () => {
    const children = {
      ".gitignore": file("*.tmp/\n"),
      ...Object.fromEntries(
        Array.from({ length: 1001 }, (_, index) => [
          `d${String(index).padStart(4, "0")}.tmp`,
          directory({ "a.md": hit() }),
        ]),
      ),
    } satisfies MemoryTree;
    const port = createMemoryPort(children);
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { entries: null, files: null, bytes: null } },
    );
    expect(result.ignored?.paths).toHaveLength(1000);
    expect(result.ignored?.atLeast).toBe(true);
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

  it("ends the page before a warning line that no longer fits", async () => {
    // One passage plus its cursor fills the page but for one unit, so the
    // `[warnings: …]` line the binary skip would add has no room.
    const tree = {
      "a.md": hit(),
      "b.bin": binary(Uint8Array.of(0x00, 0x01)),
    };
    const whole = await runMemoryScan(
      [memoryScope(0, "/repo/", createMemoryPort(tree))],
      ["hit"],
    );
    const passage = whole.results[0];
    if (passage === undefined) throw new Error("the fixture has a passage");
    const pageUnits =
      grepPassageUnits(undefined, passage) +
      grepContinuationUnits({ scopeIndex: 0, rel: "a.md", startLine: 1 }) +
      1;
    const port = createMemoryPort(tree);
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { pageUnits },
    });
    expect(first.results.map((entry) => entry.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    // The skip's line belongs to the next call, so this page reports no count
    // and still renders inside its bound.
    expect(first.warnings).toEqual([]);
    expect(first.complete).toBe(false);
    expect(
      measureGrepRendering({
        results: first.results,
        complete: first.complete,
        warnings: first.warnings,
        ...(first.cursor !== undefined && { cursor: first.cursor }),
      }),
    ).toBeLessThanOrEqual(pageUnits);

    const second = await runMemoryScan([scope], ["hit"], {
      cursor: passageCursor(first.cursor),
    });
    expect(second.warnings).toEqual([{ kind: "binary", count: 1 }]);
    expect(second.complete).toBe(true);
  });

  it("names the bound a scope starts already spent under", async () => {
    const cases = [
      { budget: { files: 0 }, warning: "file_bound" },
      { budget: { entries: 0 }, warning: "entry_bound" },
      { budget: { bytes: 0 }, warning: "byte_bound" },
    ] as const;
    for (const { budget, warning } of cases) {
      const port = createMemoryPort({ "a.md": hit(), "b.md": hit() });
      const result = await runMemoryScan(
        [memoryScope(0, "/repo/", port)],
        ["hit"],
        { budget },
      );
      expect(result.results).toEqual([]);
      expect(result.complete).toBe(false);
      expect(result.warnings).toEqual([{ kind: warning, count: 1 }]);
      expect(decode(result.cursor)).toMatchObject({
        kind: "position",
        scopeIndex: 0,
        rel: "",
      });
    }
  });

  it("names the last reached file when the file bound stops a walk without a passage", async () => {
    const port = createMemoryPort({
      "a.md": file("miss\n"),
      "b.md": file("miss\n"),
      "c.md": hit(),
    });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { files: 2 },
    });
    expect(first.results).toEqual([]);
    expect(first.complete).toBe(false);
    expect(first.warnings).toEqual([{ kind: "file_bound", count: 1 }]);
    const cursor = decode(first.cursor);
    expect(cursor).toMatchObject({
      kind: "position",
      scopeIndex: 0,
      rel: "b.md",
    });
    const second = await runMemoryScan([scope], ["hit"], { cursor });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/c.md:1-1",
    ]);
    expect(second.complete).toBe(true);
    expect(port.reads).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("names the last reached file when the deadline stops a walk without a passage", async () => {
    const port = createMemoryPort({
      "a.md": file("miss\n"),
      "b.md": file("miss\n"),
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
    expect(result.results).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([{ kind: "deadline", count: 1 }]);
    expect(decode(result.cursor)).toMatchObject({
      kind: "position",
      rel: "b.md",
    });
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

  it("counts one entry-bound warning when nested directories stop", async () => {
    const port = createMemoryPort({
      d1: directory({ "a.md": hit() }),
      d2: directory({ "b.md": hit() }),
      d3: directory({ "c.md": hit() }),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { entries: 1 },
      },
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "entry_bound", count: 1 }]);
    expect(result.complete).toBe(false);
    expect(decode(result.cursor)).toMatchObject({
      kind: "position",
      rel: "d1",
    });
  });

  it("stops at the byte bound before opening a file and restarts the scope", async () => {
    const port = createMemoryPort({ "a.md": hit() });
    const scope = memoryScope(0, "/repo/", port);
    const result = await runMemoryScan([scope], ["hit"], {
      budget: { bytes: 0 },
    });
    expect(result.results).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([{ kind: "byte_bound", count: 1 }]);
    expect(port.reads).toEqual([]);
    // No entry was reached, so the cursor names the scope before its start.
    const cursor = decode(result.cursor);
    expect(cursor).toMatchObject({
      kind: "position",
      scopeIndex: 0,
      rel: "",
    });
    const second = await runMemoryScan([scope], ["hit"], { cursor });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    expect(second.complete).toBe(true);
  });

  it("resumes past 20,000 unopened link entries", async () => {
    const tree: Record<string, MemoryNode> = {};
    for (let index = 0; index <= 20_000; index += 1)
      tree[`l${String(index).padStart(5, "0")}`] = { kind: "link" };
    tree["z.md"] = hit();
    const port = createMemoryPort(tree);
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { entries: 20_000 },
    });
    expect(first.results).toEqual([]);
    expect(first.complete).toBe(false);
    expect(first.warnings).toEqual([{ kind: "entry_bound", count: 1 }]);
    // The bound stopped before the file, but every link it counted was reached.
    const cursor = decode(first.cursor);
    expect(cursor).toMatchObject({ kind: "position", rel: "l19999" });
    const second = await runMemoryScan([scope], ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/z.md:1-1",
    ]);
    expect(second.complete).toBe(true);
    // The re-listed links are exempt from the bound: only the two after it count.
    expect(second.consumed.entries).toBe(2);
    expect(port.reads).toEqual(["z.md"]);
  });

  it("restarts the scope when the deadline stops the walk before the first file", async () => {
    const port = createMemoryPort({ "a.md": hit() });
    const scope = memoryScope(0, "/repo/", port);
    let clock = 0;
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { deadlineMs: 2500 },
      now: () => (clock += 5000),
    });
    expect(first.results).toEqual([]);
    expect(first.complete).toBe(false);
    expect(first.warnings).toEqual([{ kind: "deadline", count: 1 }]);
    // The read-ahead opened the file the deadline then stopped the walk
    // before; its stream closes and its outcome is discarded.
    expect(port.reads).toEqual(["a.md"]);
    expect(port.closes).toEqual(["a.md"]);
    const cursor = decode(first.cursor);
    expect(cursor).toMatchObject({ kind: "position", scopeIndex: 0, rel: "" });
    const second = await runMemoryScan([scope], ["hit"], { cursor });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    expect(second.complete).toBe(true);
  });

  it("never re-opens a single-file scope after a later scope stops at a bound", async () => {
    const solo = createSingleFilePort(file("miss\n"));
    const rest = createMemoryPort({ "a.md": hit() });
    const scopes = [
      memoryScope(0, "/repo/solo.md", solo, { singleFile: true }),
      memoryScope(1, "/repo/dir/", rest),
    ];
    const first = await runMemoryScan(scopes, ["hit"], {
      budget: { files: 1 },
    });
    expect(first.complete).toBe(false);
    expect(solo.reads).toEqual([""]);
    expect(decode(first.cursor)).toMatchObject({
      kind: "position",
      scopeIndex: 1,
      rel: "",
    });
    const second = await runMemoryScan(scopes, ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      "/repo/dir/a.md:1-1",
    ]);
    expect(solo.reads).toEqual([""]);
  });

  it("hands back its own cursor when a resumed call stops before any progress", async () => {
    const text = Array.from({ length: 30 }, () => "hit").join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`) });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { pageUnits: 150 },
    });
    const cursor = passageCursor(first.cursor);
    let clock = 0;
    const stalled = await runMemoryScan([scope], ["hit"], {
      cursor,
      budget: { deadlineMs: 2500 },
      now: () => (clock += 5000),
    });
    expect(stalled.results).toEqual([]);
    expect(stalled.complete).toBe(false);
    // Never behind the cursor it was given: no replay of the first page.
    expect(decode(stalled.cursor)).toEqual(cursor);
  });

  it("advances a directory position on resume", async () => {
    const port = createMemoryPort({
      d: directory({ "a.md": file("miss\n"), "b.md": file("miss\n") }),
      "z.md": hit(),
    });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { entries: 1 },
    });
    // The directory was reached before it was descended, so the cursor names it.
    expect(decode(first.cursor)).toMatchObject({
      kind: "position",
      rel: "d",
    });
    const second = await runMemoryScan([scope], ["hit"], {
      cursor: decode(first.cursor),
      budget: { entries: 1 },
    });
    expect(second.results).toEqual([]);
    // The first child it opened moves the resume point past the directory.
    expect(decode(second.cursor)).toMatchObject({
      kind: "position",
      rel: "d/a.md",
    });
    const third = await runMemoryScan([scope], ["hit"], {
      cursor: decode(second.cursor),
    });
    expect(third.results.map((passage) => passage.locator)).toEqual([
      "/repo/z.md:1-1",
    ]);
    expect(third.complete).toBe(true);
    expect(port.reads).toEqual(["d/a.md", "d/b.md", "z.md"]);
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
      budget: { pageUnits: reservedRoom("a.md", 50) },
    });
    expect(first.results.length).toBeGreaterThan(0);
    expect(first.results.length).toBeLessThan(6);
    expect(first.complete).toBe(false);
    const second = await runMemoryScan([scope], ["hit"], {
      cursor: decode(first.cursor),
    });
    expect(second.results).toHaveLength(6 - first.results.length);
    expect(second.complete).toBe(true);
  });

  it("keeps its cursor and the caller's fields inside the page bound", async () => {
    const text = Array.from({ length: 60 }, (_, index) =>
      (index + 1) % 5 === 1 ? "hit" : "x",
    ).join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`) });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { pageUnits: 700, fixedReserve: 300 } },
    );
    expect(result.complete).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    const page = {
      results: result.results,
      complete: false,
      cursor: result.cursor,
    };
    expect(measureGrepRendering(page) + 300).toBeLessThanOrEqual(700);
  });

  it("cuts a first passage that does not fit at a line boundary", async () => {
    const text = Array.from({ length: 30 }, () => "hit").join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`) });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      {
        budget: { pageUnits: reservedRoom("a.md", 150) },
      },
    );
    expect(result.results).toHaveLength(1);
    // A cut passage is marked as cut, not as its file's capped twentieth.
    expect(result.results[0].cut).toBe(true);
    expect(result.results[0].truncated).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.results[0].locator).not.toBe("/repo/a.md:1-30");
    const cursor = passageCursor(result.cursor);
    expect(cursor).toMatchObject({ rel: "a.md", startLine: 1 });
    expect(cursor.endLine).toBe(
      Number(result.results[0].locator.split(":")[1].split("-")[1]),
    );
  });

  it("resumes a cut passage after its last emitted line", async () => {
    const text = Array.from({ length: 30 }, () => "hit").join("\n");
    const port = createMemoryPort({ "a.md": file(`${text}\n`) });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"], {
      budget: { pageUnits: reservedRoom("a.md", 150) },
    });
    const cursor = passageCursor(first.cursor);
    const emittedEnd = cursor.endLine;
    if (emittedEnd === undefined) throw new Error("expected a cut line");
    expect(emittedEnd).toBeGreaterThanOrEqual(1);
    expect(emittedEnd).toBeLessThan(30);
    const second = await runMemoryScan([scope], ["hit"], { cursor });
    expect(second.results.map((passage) => passage.locator)).toEqual([
      `/repo/a.md:${emittedEnd + 1}-30`,
    ]);
    expect(second.results[0].content.split("\n")[0]).toBe(
      `${emittedEnd + 1}: hit`,
    );
    expect(second.results[0].content.split("\n")).toHaveLength(30 - emittedEnd);
    expect(second.complete).toBe(true);
  });

  it("emits no rest when only context lines follow the cut", async () => {
    const port = createMemoryPort({ "a.md": file("hit\nctx\n") });
    const scope = memoryScope(0, "/repo/", port);
    const second = await runMemoryScan([scope], ["hit"], {
      cursor: {
        kind: "passage",
        scopeIndex: 0,
        rel: "a.md",
        startLine: 1,
        endLine: 1,
        inputHash: "test-hash",
      },
    });
    expect(second.results).toEqual([]);
    expect(second.complete).toBe(true);
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

describe("grep streamed files", () => {
  /** A two-mebibyte log whose last line matches. */
  function largeLog(): string {
    return `${"x".repeat(1023)}\n`.repeat(2000) + "needle\n";
  }

  it("searches a two-mebibyte file when no file-size bound is set", async () => {
    const port = createMemoryPort({ "big.md": file(largeLog()) });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/big.md:2000-2001",
    ]);
    expect(result.complete).toBe(true);
  });

  it("skips a file over the configured file-size bound and counts it", async () => {
    const port = createMemoryPort({ "big.md": file(largeLog()) });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
      { budget: { maxFileBytes: 1024 } },
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "oversized", count: 1 }]);
  });

  it("searches a file exactly at the announced size bound", async () => {
    const port = createMemoryPort({
      "exact.md": { kind: "file", content: "needle\n", announcedSize: 7 },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
      { budget: { maxFileBytes: 7 } },
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/exact.md:1-1",
    ]);
    // Only the stream's own end closes it: no refusal closed it early.
    expect(port.closes).toEqual(["exact.md"]);
  });

  it("searches a file at the streamed bound when its announced size hides it", async () => {
    const port = createMemoryPort({
      "exact.md": {
        kind: "file",
        content: "needle\n",
        announcedSize: 0,
        chunkBytes: 3,
      },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
      { budget: { maxFileBytes: 7 } },
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/exact.md:1-1",
    ]);
  });

  it("closes the stream it refuses on the announced size", async () => {
    const port = createMemoryPort({
      "big.md": { kind: "file", content: "needle\n", announcedSize: 99 },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
      { budget: { maxFileBytes: 10 } },
    );
    expect(result.warnings).toEqual([{ kind: "oversized", count: 1 }]);
    expect(result.consumed.bytes).toBe(0);
    expect(port.closes).toEqual(["big.md"]);
  });

  it("skips a file that grows past the file-size bound", async () => {
    const port = createMemoryPort({
      "grows.md": {
        kind: "file",
        content: `needle\n${"x".repeat(2 * 1024 * 1024)}\n`,
        announcedSize: 1024,
      },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
      { budget: { maxFileBytes: 1024 * 1024 } },
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "oversized", count: 1 }]);
  });

  it("searches every file when a count bound is null", async () => {
    const port = createMemoryPort({
      "a.md": hit(),
      "b.md": hit(),
      "c.md": hit(),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
      { budget: { files: null, entries: null, bytes: null } },
    );
    expect(result.results).toHaveLength(3);
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("skips a file with a line longer than 4 MiB", async () => {
    const port = createMemoryPort({
      "one-line.md": file(`hit\n${"x".repeat(4 * 1024 * 1024 + 1)}\n`),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "oversized", count: 1 }]);
  });

  it("drops a file whose late byte is not valid UTF-8", async () => {
    const bytes = Buffer.concat([
      Buffer.from("a\nb\nhit\n", "utf8"),
      Buffer.from("y".repeat(900_000), "utf8"),
      Buffer.from([0xff, 0x0a]),
    ]);
    const port = createMemoryPort({ "late.md": binary(bytes) });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "invalid_utf8", count: 1 }]);
  });

  it("drops the passages of a file with a late over-long line", async () => {
    const port = createMemoryPort({
      "late.md": file(
        `hit\n${"x\n".repeat(8)}${"x".repeat(4 * 1024 * 1024 + 1)}\n`,
      ),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "oversized", count: 1 }]);
  });

  it("drops a file whose stream ends with a refusal", async () => {
    const port = createMemoryPort({
      "vanished.md": {
        kind: "file",
        content: "hit\n",
        lateRefusal: "unreadable",
      },
      "a.md": hit(),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-1",
    ]);
    expect(result.warnings).toEqual([{ kind: "unreadable", count: 1 }]);
    // The refused file's bytes are still the consumer's; both count.
    expect(result.consumed.bytes).toBe(8);
  });

  it("keeps a later match after a gap longer than the held content", async () => {
    const filler = `${"x".repeat(200)}\n`.repeat(2000);
    const port = createMemoryPort({
      "gap.md": file(`needle one\n${filler}needle two\n`),
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["needle"],
    );
    expect(result.results.map((passage) => passage.locator)).toEqual([
      "/repo/gap.md:1-2",
      "/repo/gap.md:2001-2002",
    ]);
    expect(result.complete).toBe(true);
  });

  it("drops a file whose late byte across chunks is not valid UTF-8", async () => {
    const bytes = Buffer.concat([
      Buffer.from("hit\n", "utf8"),
      Buffer.from("y".repeat(200_000), "utf8"),
      Buffer.from([0xff, 0x0a]),
    ]);
    const port = createMemoryPort({
      "late.md": { kind: "binary", bytes, chunkBytes: 64 * 1024 },
    });
    const result = await runMemoryScan(
      [memoryScope(0, "/repo/", port)],
      ["hit"],
    );
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([{ kind: "invalid_utf8", count: 1 }]);
  });

  it("keeps a match after a complete passage frees the hold limit", async () => {
    const line = (n: number) =>
      `${n <= 28 || n === 35 ? "hit" : "filler"} ${"x".repeat(493)}`;
    const content = `${Array.from({ length: 35 }, (_v, index) => line(index + 1)).join("\n")}\n`;
    const port = createMemoryPort({ "a.md": file(content) });
    const scope = memoryScope(0, "/repo/", port);
    const first = await runMemoryScan([scope], ["hit"]);
    expect(first.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:1-29",
    ]);
    // The page could not hold the second passage, so the call continues.
    expect(first.complete).toBe(false);
    const rest = await runMemoryScan([scope], ["hit"], {
      cursor: passageCursor(first.cursor),
    });
    expect(rest.results.map((passage) => passage.locator)).toEqual([
      "/repo/a.md:34-35",
    ]);
    expect(rest.results[0].matches).toEqual([35]);
  });

  it("loses no line of a cut passage that spans several pages", async () => {
    const lines = Array.from(
      { length: 60 },
      (_, index) =>
        `hit ${String(index + 1).padStart(2, "0")} ${"x".repeat(600)}`,
    );
    const port = createMemoryPort({ "long.md": file(`${lines.join("\n")}\n`) });
    const scope = memoryScope(0, "/repo/", port);
    const seen: Array<number> = [];
    let cursor: GrepPassageCursor | undefined;
    let complete = false;
    for (let call = 0; call < 10 && !complete; call += 1) {
      const page = await runMemoryScan([scope], ["hit"], {
        ...(cursor !== undefined && { cursor }),
      });
      complete = page.complete;
      for (const passage of page.results) {
        const [start, end] = passage.locator
          .split(":")[1]
          .split("-")
          .map((value) => Number(value));
        expect(passage.matches.length).toBeGreaterThan(0);
        for (let line = start; line <= end; line += 1) seen.push(line);
      }
      if (!page.complete) cursor = passageCursor(page.cursor);
    }
    expect(seen).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
    expect(complete).toBe(true);
  });
});
