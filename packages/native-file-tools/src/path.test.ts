import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySelectorSuffix,
  canonicalSelector,
  formatLineRange,
  isSelectorSuffix,
  parsePathScheme,
  resolveEndRelativeSelector,
  resolveReadTarget,
  splitSelectorSuffix,
} from "./path";
import { readFile } from "./read";

/** The shared refusal, as a model that wrote a malformed selector reads it. */
const SHARED_REFUSAL =
  "A line selector is :L5, :L5-10, :L5+10, :L5-, or :-L5, or a comma-separated list of them. A bare number also reads as a line. :raw is the whole file, or :raw: followed by a list of them, and :outline takes one of them after the colon. A line number starts at 1.";

/** A source of `count` short lines, so a read's shown context is evident. */
const numbered = (count: number): string =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}\n`).join("");

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

  it.each([
    ["outline", { offset: 0, raw: false, outline: true }],
    ["outline:5", { offset: 4, limit: 1, raw: false, outline: true }],
    ["outline:5-9", { offset: 4, limit: 5, raw: false, outline: true }],
    ["outline:5+3", { offset: 4, limit: 3, raw: false, outline: true }],
  ])("normalizes %s", async (selector, target) => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:${selector}`)).toEqual({
      path,
      ...target,
    });
  });

  it("keeps raw precedence for a path ending in outline", async () => {
    const path = join(directory, "a.md:outline");
    expect(await resolveReadTarget(`${path}:raw`)).toEqual({
      path,
      offset: 0,
      raw: true,
    });
  });

  it.each(["outline:1,3", "outline:", "outline:x", "raw:outline"])(
    "rejects invalid outline selector %s",
    async (selector) => {
      await expect(
        resolveReadTarget(`${directory}/notes:${selector}`),
      ).rejects.toMatchObject({ type: "invalid_selector" });
    },
  );

  it("prefers an existing literal outline-selector filename", async () => {
    const path = join(directory, "notes:outline");
    await writeFile(path, "literal");
    expect(await resolveReadTarget(path)).toEqual({
      path,
      offset: 0,
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
    "-0",
    "-1-3",
    "0-",
    "1-9007199254740992",
    "9007199254740991+2",
    "-9007199254740992",
    "raw:",
    "raw:-0",
  ])("rejects invalid %s", async (selector) => {
    await expect(
      resolveReadTarget(`${directory}/notes:${selector}`),
    ).rejects.toMatchObject({ type: "invalid_selector" });
  });

  it("claims a trailing colon member for the file beside it", async () => {
    // A trailing `:raw` claims the colon segment before it as the member list
    // whenever that segment has the list shape, so here `notes:5-` is the
    // member `5-` of `notes` rather than a filename: the read names lines from
    // the fifth to the end and stays pending for the reader to place.
    const notes = join(directory, "notes");
    await writeFile(notes, "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    await writeFile(join(directory, "notes:5-"), "literal");
    expect(await resolveReadTarget(`${notes}:5-:raw`)).toEqual({
      path: notes,
      offset: 0,
      raw: true,
      pending: "5-",
    });
    // Spelling the escape keeps the literal file reachable: the trailing
    // `:raw:1-2` is a member list of its own, so the path is probed whole.
    expect(await resolveReadTarget(`${notes}:5-:raw:1-2`)).toEqual({
      path: join(directory, "notes:5-"),
      offset: 0,
      limit: 2,
      raw: true,
    });
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

  it("sorts, merges, and expands comma ranges", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:20-30,5-10,10+10`)).toEqual({
      path,
      offset: 4,
      raw: false,
      ranges: [{ offset: 4, limit: 26 }],
      expandedRanges: [{ offset: 3, limit: 28 }],
    });
  });

  it("keeps disjoint ranges separate with per-range context", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:20-30,5-10`)).toEqual({
      path,
      offset: 4,
      raw: false,
      ranges: [
        { offset: 4, limit: 6 },
        { offset: 19, limit: 11 },
      ],
      expandedRanges: [
        { offset: 3, limit: 8 },
        { offset: 18, limit: 13 },
      ],
    });
  });

  it("merges expansions that touch", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:4-5,7-8`)).toEqual({
      path,
      offset: 3,
      raw: false,
      ranges: [
        { offset: 3, limit: 2 },
        { offset: 6, limit: 2 },
      ],
      expandedRanges: [{ offset: 2, limit: 7 }],
    });
  });

  it("clips expansion at the first line", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:1-2,5-6`)).toEqual({
      path,
      offset: 0,
      raw: false,
      ranges: [
        { offset: 0, limit: 2 },
        { offset: 4, limit: 2 },
      ],
      expandedRanges: [{ offset: 0, limit: 7 }],
    });
  });

  it("preserves comma mode when members merge to one range", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:20-30,20-30`)).toEqual({
      path,
      offset: 19,
      raw: false,
      ranges: [{ offset: 19, limit: 11 }],
      expandedRanges: [{ offset: 18, limit: 13 }],
    });
    expect(await resolveReadTarget(`${path}:20-30`)).toEqual({
      path,
      offset: 19,
      limit: 11,
      raw: false,
    });
  });

  it("accepts plus members in a comma selector", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:5+3,20+2`)).toEqual({
      path,
      offset: 4,
      raw: false,
      ranges: [
        { offset: 4, limit: 3 },
        { offset: 19, limit: 2 },
      ],
      expandedRanges: [
        { offset: 3, limit: 5 },
        { offset: 18, limit: 4 },
      ],
    });
  });

  it("keeps raw multi-range reads verbatim", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:raw:5-10,20-30`)).toEqual({
      path,
      offset: 4,
      raw: true,
      ranges: [
        { offset: 4, limit: 6 },
        { offset: 19, limit: 11 },
      ],
      expandedRanges: [
        { offset: 4, limit: 6 },
        { offset: 19, limit: 11 },
      ],
    });
  });

  it("takes a plus member in a raw list", async () => {
    const path = join(directory, "notes");
    expect(await resolveReadTarget(`${path}:raw:5-10,20+2`)).toEqual({
      path,
      offset: 4,
      raw: true,
      ranges: [
        { offset: 4, limit: 6 },
        { offset: 19, limit: 2 },
      ],
      expandedRanges: [
        { offset: 4, limit: 6 },
        { offset: 19, limit: 2 },
      ],
    });
  });

  it.each([
    "5-10,,20-30",
    "5-10,",
    ",5-10",
    "5-10,0-2",
    "5-10,2-1",
    "5-10, 20-30",
    "5-10,-0",
    "raw:5-10,",
    "raw:5-10,-",
  ])("rejects invalid multi-range %s", async (selector) => {
    await expect(
      resolveReadTarget(`${directory}/notes:${selector}`),
    ).rejects.toMatchObject({ type: "invalid_selector" });
  });

  it.each([
    ["-20", 500, { offset: 480, limit: 20, raw: false }],
    ["-900", 500, { offset: 0, limit: 500, raw: false }],
    ["-3", 3, { offset: 0, limit: 3, raw: false }],
    ["50-", 3000, { offset: 49, limit: 2951, raw: false }],
    ["50-", 500, { offset: 49, limit: 451, raw: false }],
    ["raw:-2", 3, { offset: 1, limit: 2, raw: true }],
    ["outline:-2", 3, { offset: 1, limit: 2, raw: false, outline: true }],
    [
      "50-,-10",
      100,
      {
        offset: 49,
        raw: false,
        ranges: [{ offset: 49, limit: 51 }],
        expandedRanges: [{ offset: 48, limit: 53 }],
      },
    ],
    [
      "raw:1-5,30-",
      40,
      {
        offset: 0,
        raw: true,
        ranges: [
          { offset: 0, limit: 5 },
          { offset: 29, limit: 11 },
        ],
        expandedRanges: [
          { offset: 0, limit: 5 },
          { offset: 29, limit: 11 },
        ],
      },
    ],
  ])("resolves %s against a count of %i", (selector, count, expected) => {
    expect(
      resolveEndRelativeSelector(
        applySelectorSuffix("/root/a.md", selector),
        count,
      ),
    ).toStrictEqual({ path: "/root/a.md", ...expected });
  });

  it("keeps a past-the-end member as the first requested start", () => {
    expect(
      resolveEndRelativeSelector(
        applySelectorSuffix("/root/a.md", "501-"),
        500,
      ),
    ).toStrictEqual({ path: "/root/a.md", offset: 500, raw: false });
    expect(
      resolveEndRelativeSelector(
        applySelectorSuffix("/root/a.md", "501-,600-"),
        500,
      ),
    ).toStrictEqual({
      path: "/root/a.md",
      offset: 500,
      raw: false,
      ranges: [],
      expandedRanges: [],
    });
  });

  it.each(["-5,-10", "1-,1-2", "-5,3-4"])(
    "keeps the comma shape when %s resolves its first start empty",
    (selector) => {
      // An empty first start is the shipped start-past-EOF window the reader
      // refuses, and a comma request still reports plural fields so that
      // refusal reads as the empty multi-range result it is.
      expect(
        resolveEndRelativeSelector(
          applySelectorSuffix("/root/a.md", selector),
          0,
        ),
      ).toStrictEqual({
        path: "/root/a.md",
        offset: 0,
        raw: false,
        ranges: [],
        expandedRanges: [],
      });
    },
  );

  it("drops a later past-the-end member before merge and context growth", () => {
    expect(
      resolveEndRelativeSelector(
        applySelectorSuffix("/root/a.md", "1-5,501-"),
        500,
      ),
    ).toStrictEqual({
      path: "/root/a.md",
      offset: 0,
      raw: false,
      ranges: [{ offset: 0, limit: 5 }],
      expandedRanges: [{ offset: 0, limit: 6 }],
    });
  });

  it.each([
    ["-5", 0, 0],
    ["1-", 0, 0],
    ["5-", 0, 4],
  ])(
    "places the empty member of %s on a %i-line source at offset %i",
    (selector, count, offset) => {
      expect(
        resolveEndRelativeSelector(
          applySelectorSuffix("/root/a.md", selector),
          count,
        ),
      ).toStrictEqual({ path: "/root/a.md", offset, raw: false });
    },
  );

  it("caps comma selectors at 64 input ranges", async () => {
    const members = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `${i * 10 + 1}-${i * 10 + 2}`,
      ).join(",");

    const accepted = await resolveReadTarget(
      `${directory}/notes:${members(64)}`,
    );

    expect(accepted.ranges).toHaveLength(64);
    await expect(
      resolveReadTarget(`${directory}/notes:${members(65)}`),
    ).rejects.toMatchObject({ type: "invalid_selector" });
  });

  it("prefers an existing literal comma-selector filename", async () => {
    const path = join(directory, "report:5-10,20-30");
    await writeFile(path, "literal");
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
    ["11", { offset: 10, limit: 1, raw: false }],
    ["11-13", { offset: 10, limit: 3, raw: false }],
    ["11+3", { offset: 10, limit: 3, raw: false }],
    ["11,20-21", { offset: 10, raw: false }],
    ["raw", { offset: 0, raw: true }],
    ["raw:1-2", { offset: 0, limit: 2, raw: true }],
    ["raw:7", { offset: 6, limit: 1, raw: true }],
    ["raw:11+3", { offset: 10, limit: 3, raw: true }],
    ["5-9:raw", { offset: 4, limit: 5, raw: true }],
    ["1-2,4+5:raw", { offset: 0, raw: true }],
  ])("applies the split selector %s", (selector, expected) => {
    expect(applySelectorSuffix("/root/a.md", selector)).toMatchObject({
      path: "/root/a.md",
      ...expected,
    });
  });

  it.each([
    ["11-", "11-"],
    ["-11", "-11"],
    ["raw:-11", "-11"],
    ["outline:11-", "11-"],
  ])("carries the end-relative selector %s unresolved", (selector, pending) => {
    const expected = {
      path: "/root/a.md",
      offset: 0,
      raw: selector.startsWith("raw"),
      pending,
    };

    if (selector.startsWith("outline"))
      Object.assign(expected, { outline: true });
    expect(applySelectorSuffix("/root/a.md", selector)).toStrictEqual(expected);
  });

  it("carries a mixed list's members unresolved", () => {
    expect(applySelectorSuffix("/root/a.md", "1-5,50-,-20")).toStrictEqual({
      path: "/root/a.md",
      offset: 0,
      raw: false,
      pending: "1-5,50-,-20",
    });
  });

  it.each(["0", "0-1", "2-1", "raw:x", "nonsense", "-0", "outline:1,3"])(
    "rejects the split selector %s",
    (selector) => {
      expect(() => applySelectorSuffix("/root/a.md", selector)).toThrow(
        expect.objectContaining({ type: "invalid_selector" }),
      );
    },
  );
});

describe("splitSelectorSuffix", () => {
  it("returns a path with no selector key when nothing splits", () => {
    expect(splitSelectorSuffix("/root/a.md")).toStrictEqual({
      path: "/root/a.md",
    });
  });

  it("keeps a colon inside a directory name on the path", () => {
    expect(splitSelectorSuffix("/root/we:ird/a.md")).toStrictEqual({
      path: "/root/we:ird/a.md",
    });
  });

  it.each([
    ["/root/a.md:41-53", "/root/a.md", "41-53"],
    ["/root/a.md:raw", "/root/a.md", "raw"],
    ["/root/a.md:raw:1-2000", "/root/a.md", "raw:1-2000"],
    ["/root/a.md:outline", "/root/a.md", "outline"],
    ["/root/a.md:outline:5+3", "/root/a.md", "outline:5+3"],
    ["/root/a.md:outline:raw", "/root/a.md:outline", "raw"],
    ["/root/a.md:L5-10", "/root/a.md", "L5-10"],
    ["/root/a.md:-L20", "/root/a.md", "-L20"],
    ["/root/a.md:outline:L5-40", "/root/a.md", "outline:L5-40"],
    ["/root/a.md:12:5", "/root/a.md", "12:5"],
    ["/root/a.md:raw:12:5", "/root/a.md", "raw:12:5"],
    ["/root/a.md:outline:12:5", "/root/a.md", "outline:12:5"],
    ["/root/notes:P3", "/root/notes", "P3"],
    ["/root/notes:L-5", "/root/notes", "L-5"],
  ])("splits %s", (input, path, selector) => {
    expect(splitSelectorSuffix(input)).toStrictEqual({ path, selector });
  });

  it.each([
    ["/root/a.md:41-53:raw", "/root/a.md", "raw:41-53"],
    ["/root/a.md:raw:41-53", "/root/a.md", "raw:41-53"],
    ["/root/a.md:5-:raw", "/root/a.md", "raw:5-"],
    ["/root/a.md:raw:-5", "/root/a.md", "raw:-5"],
    ["/root/a.md:L4-5:raw", "/root/a.md", "raw:L4-5"],
    ["/root/a.md:raw:L4-5", "/root/a.md", "raw:L4-5"],
    ["/root/x.ts:12:5:raw", "/root/x.ts:12", "raw:5"],
    ["/root/notes:draft:raw", "/root/notes:draft", "raw"],
    ["/root/2024:10:raw", "/root/2024", "raw:10"],
    ["/root/a.md:-20", "/root/a.md", "-20"],
  ])("splits %s to the canonical selector", (input, path, selector) => {
    expect(splitSelectorSuffix(input)).toStrictEqual({ path, selector });
  });

  it("keeps a colon inside a directory name on the path before a line", () => {
    expect(splitSelectorSuffix("/root/dir:12/a.ts:5:3")).toStrictEqual({
      path: "/root/dir:12/a.ts",
      selector: "5:3",
    });
    expect(splitSelectorSuffix("/root/dir:12/a.ts")).toStrictEqual({
      path: "/root/dir:12/a.ts",
    });
  });

  it("prefers an existing literal filename to the trailing-raw split", async () => {
    // Literal-path precedence is unchanged: a file named `x:60-64:raw` is
    // that file, and `2024:10` stays raw only as `2024:10:raw:1-1`.
    const directory = await mkdtemp(join(tmpdir(), "native-split-"));

    try {
      const literal = join(directory, "x:60-64:raw");
      await writeFile(literal, "literal");
      expect(await resolveReadTarget(literal)).toEqual({
        path: literal,
        offset: 0,
        raw: false,
      });
      const dated = join(directory, "2024:10");
      await writeFile(dated, "literal");
      expect(await resolveReadTarget(`${dated}:raw:1-1`)).toEqual({
        path: dated,
        offset: 0,
        limit: 1,
        raw: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("splits a trailing suffix the caller must validate", () => {
    expect(splitSelectorSuffix("/root/notes:nonsense")).toStrictEqual({
      path: "/root/notes",
      selector: "nonsense",
    });
  });
});

describe("native line units", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-unit-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads the same lines for every line spelling", async () => {
    const path = join(directory, "notes.md");
    await writeFile(path, numbered(20));

    const results = await Promise.all(
      ["5-10", "L5-10", "l5-L10", "L5+6"].map((selector) =>
        readFile({ path: `${path}:${selector}` }),
      ),
    );

    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      status: "success",
      content:
        "4: line 4\n5: line 5\n6: line 6\n7: line 7\n8: line 8\n9: line 9\n10: line 10\n11: line 11\n",
      requestedRange: { startLine: 5, endLine: 10 },
      shownRange: { startLine: 4, endLine: 11 },
    });
  });

  it.each([
    ["L5-", "5-"],
    ["-L5", "-5"],
    ["raw:L4-5", "raw:4-5"],
    ["L4-5:raw", "4-5:raw"],
    ["outline:L5-40", "outline:5-40"],
  ])("applies %s as the bare %s", (lettered, bare) => {
    expect(applySelectorSuffix("/root/a.md", lettered)).toStrictEqual(
      applySelectorSuffix("/root/a.md", bare),
    );
  });

  it("carries the pending list without its unit letters", () => {
    expect(applySelectorSuffix("/root/a.md", "L5-,l9")).toStrictEqual({
      path: "/root/a.md",
      offset: 0,
      raw: false,
      pending: "5-,9",
    });
  });

  it("prefers an existing literal lettered filename", async () => {
    const path = join(directory, "notes:L5");
    await writeFile(path, "literal");
    expect(await resolveReadTarget(path)).toEqual({
      path,
      offset: 0,
      raw: false,
    });
  });

  it.each(["L5+L10", "5-L10"])(
    "refuses %s as outside the grammar",
    async (selector) => {
      const path = join(directory, "notes.md");
      await writeFile(path, numbered(20));
      const target = resolveReadTarget(`${path}:${selector}`);
      await expect(target).rejects.toMatchObject({
        type: "invalid_selector",
        message: SHARED_REFUSAL,
      });
    },
  );

  it("combines bare and lettered members in one list", async () => {
    const path = join(directory, "notes.md");
    const lettered = await resolveReadTarget(`${path}:L5-16,L960-973`);
    expect(lettered).toEqual(await resolveReadTarget(`${path}:5-16,L960-973`));
    expect(lettered).toMatchObject({
      offset: 4,
      ranges: [
        { offset: 4, limit: 12 },
        { offset: 959, limit: 14 },
      ],
      expandedRanges: [
        { offset: 3, limit: 14 },
        { offset: 958, limit: 16 },
      ],
    });
  });

  it("refuses a list that names a reserved unit", async () => {
    const path = join(directory, "notes.md");
    await writeFile(path, numbered(20));
    expect(await readFile({ path: `${path}:L5,P2` })).toEqual({
      status: "error",
      type: "invalid_selector",
      message: SHARED_REFUSAL,
    });
  });

  it("refuses a letter before the minus sign with the fixed hint", async () => {
    const path = join(directory, "notes.md");
    await writeFile(path, numbered(30));
    expect(await readFile({ path: `${path}:L-20` })).toEqual({
      status: "error",
      type: "invalid_selector",
      message: "Write -L20 for the last 20 lines, or L1-20 for the first 20.",
    });
  });

  it.each([
    ["l-5", "Write -L5 for the last 5 lines, or L1-5 for the first 5."],
    ["5-10,L-3", "Write -L3 for the last 3 lines, or L1-3 for the first 3."],
  ])("refuses %s with the fixed hint", async (selector, message) => {
    const path = join(directory, "notes.md");
    const target = resolveReadTarget(`${path}:${selector}`);
    await expect(target).rejects.toMatchObject({
      type: "invalid_selector",
      message,
    });
  });

  it("splits a misplaced letter as a selector the applier refuses", () => {
    // A remote split has no literal probe, so the shape must claim the suffix
    // and the applier must be the one that names both readings.
    expect(splitSelectorSuffix("/notes:L-5")).toStrictEqual({
      path: "/notes",
      selector: "L-5",
    });
    expect(() => applySelectorSuffix("/notes", "L-5")).toThrow(
      expect.objectContaining({
        type: "invalid_selector",
        message: "Write -L5 for the last 5 lines, or L1-5 for the first 5.",
      }),
    );
  });

  it.each(["P3", "p3", "-M2", "M2-5", "P3+2", "raw:P3", "M1:raw"])(
    "refuses the reserved unit in %s",
    async (selector) => {
      const path = join(directory, "notes.md");
      await writeFile(path, numbered(20));
      expect(await readFile({ path: `${path}:${selector}` })).toEqual({
        status: "error",
        type: "invalid_selector",
        message: SHARED_REFUSAL,
      });
    },
  );

  it("admits a refused shape as a selector and keeps another letter on the path", () => {
    for (const selector of [
      "P3",
      "-M2",
      "L-5",
      "raw:12:5",
      "outline:12:5",
      "12:5",
    ])
      expect(isSelectorSuffix(selector)).toBe(true);
    expect(isSelectorSuffix("X5")).toBe(false);
  });

  it("prefers an existing literal reserved-unit filename", async () => {
    const path = join(directory, "notes:P3");
    await writeFile(path, "literal");
    expect(await resolveReadTarget(path)).toEqual({
      path,
      offset: 0,
      raw: false,
    });
  });
});

describe("native line and column", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-line-column-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads the line of a compiler location with its context", async () => {
    const path = join(directory, "x.ts");
    await writeFile(path, numbered(20));
    expect(await readFile({ path: `${path}:12:5` })).toMatchObject({
      status: "success",
      content: "11: line 11\n12: line 12\n13: line 13\n",
      requestedRange: { startLine: 12, endLine: 12 },
      shownRange: { startLine: 11, endLine: 13 },
    });
  });

  it("reads a line and column as its line member", () => {
    expect(applySelectorSuffix("/root/a.md", "12:5")).toStrictEqual({
      path: "/root/a.md",
      offset: 11,
      limit: 1,
      raw: false,
    });
  });

  it("prefers an existing literal line-and-column filename", async () => {
    const path = join(directory, "x:12:5");
    await writeFile(path, "literal");
    expect(await resolveReadTarget(path)).toEqual({
      path,
      offset: 0,
      raw: false,
    });
  });

  it("reads a lettered line of a filename that carries a colon", async () => {
    const path = join(directory, "x.ts:12");
    await writeFile(path, numbered(20));
    expect(await readFile({ path: `${path}:L5` })).toMatchObject({
      status: "success",
      content: "4: line 4\n5: line 5\n6: line 6\n",
      requestedRange: { startLine: 5, endLine: 5 },
    });
  });

  it("refuses a zero line", async () => {
    const path = join(directory, "x.ts");
    await writeFile(path, numbered(20));
    expect(await readFile({ path: `${path}:0:5` })).toEqual({
      status: "error",
      type: "invalid_selector",
      message: SHARED_REFUSAL,
    });
  });

  it("keeps a final raw as line 10 of the file before it", async () => {
    const path = join(directory, "2024");
    await writeFile(path, numbered(12));
    expect(await readFile({ path: `${path}:10:raw` })).toMatchObject({
      status: "success",
      content: "line 10\n",
      requestedRange: { startLine: 10, endLine: 10 },
      shownRange: { startLine: 10, endLine: 10 },
    });
  });

  it.each(["raw:12:5", "outline:12:5"])(
    "refuses a representation with a line and column: %s",
    async (selector) => {
      const path = join(directory, "x.ts");
      await writeFile(path, numbered(20));
      expect(await readFile({ path: `${path}:${selector}` })).toEqual({
        status: "error",
        type: "invalid_selector",
        message: SHARED_REFUSAL,
      });
    },
  );

  it("keeps the raw split when a line and column comes before the raw", async () => {
    const path = join(directory, "x.ts:12");
    await writeFile(path, numbered(20));
    expect(await readFile({ path: `${path}:5:raw` })).toMatchObject({
      status: "success",
      content: "line 5\n",
      requestedRange: { startLine: 5, endLine: 5 },
    });
  });
});

describe("canonicalSelector", () => {
  it.each([
    ["5", "L5"],
    ["l5", "L5"],
    ["5-10", "L5-10"],
    ["l5-L10", "L5-10"],
    ["5+10", "L5+10"],
    ["5-", "L5-"],
    ["-5", "-L5"],
    ["-l5", "-L5"],
    ["5,L10", "L5,L10"],
    ["L5-16,L960-973", "L5-16,L960-973"],
    ["raw", "raw"],
    ["raw:5-10", "raw:L5-10"],
    ["5-10:raw", "raw:L5-10"],
    ["raw:-5", "raw:-L5"],
    ["outline", "outline"],
    ["outline:5-40", "outline:L5-40"],
    ["12:5", "L12"],
  ])("writes %s as %s", (selector, canonical) => {
    expect(canonicalSelector(selector)).toBe(canonical);
  });

  it.each(["P3", "M2-5", "L-5", "raw:12:5", "outline:12:5", "X5", "", "5-10x"])(
    "writes nothing for %s",
    (selector) => {
      expect(canonicalSelector(selector)).toBeUndefined();
    },
  );
});

describe("formatLineRange", () => {
  it("writes the region as one canonical range", () => {
    expect(formatLineRange(1, 5)).toBe("L1-5");
    expect(formatLineRange(11, 13)).toBe("L11-13");
  });
});
