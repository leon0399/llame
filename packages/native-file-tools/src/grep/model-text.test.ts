import { spellGrepHostScopeLocator } from "./scope";
import {
  grepArtifactLines,
  grepIgnoredUnits,
  measureGrepRendering,
  renderGrepText,
} from "./model-text";

/** One stored passage of the fixture page, with the marks the page adds. */
function passage(
  locator: string,
  content: string,
  matches: ReadonlyArray<number>,
  marks: { readonly truncated?: boolean; readonly cut?: boolean } = {},
) {
  return {
    locator,
    content,
    matches,
    ...(marks.cut && { cut: true as const }),
    ...(marks.truncated && { truncated: true as const }),
  };
}

describe("grep text rendering", () => {
  it("groups two passages of one file under one file line", () => {
    const text = renderGrepText({
      results: [
        passage("src/app.ts:3-4", "3: a\n4: b", [4]),
        passage("src/app.ts:40-41", "40: c\n41: d", [40]),
      ],
      complete: true,
      warnings: [],
    });
    expect(text).toBe("## src/app.ts\n3: a\n*4: b\n\n*40: c\n41: d");
  });

  it("repeats the file line for an overlapping later scope", () => {
    const text = renderGrepText({
      results: [
        passage("src/app.ts:3-4", "3: a\n4: b", [3]),
        passage("src/app.ts:40-41", "40: c\n41: d", [40]),
        passage("src/app.ts:3-4", "3: a\n4: b", [3]),
      ],
      complete: true,
    });
    expect(text.split("\n").filter((line) => line.startsWith("## "))).toEqual([
      "## src/app.ts",
      "## src/app.ts",
    ]);
  });

  it("marks only a passage's matched lines, by their absolute numbers", () => {
    const text = renderGrepText({
      results: [passage("a.md:39-41", "39: a\n40: b\n41: c", [40])],
      complete: true,
    });
    expect(text.split("\n").slice(1)).toEqual(["39: a", "*40: b", "41: c"]);
  });

  it("keeps the file locator free of a range a path carries a colon in", () => {
    const text = renderGrepText({
      results: [passage("machine://box/srv/a:1.go:3-4", "3: a", [3])],
      complete: true,
    });
    expect(text.split("\n")[0]).toBe("## machine://box/srv/a:1.go");
  });

  it("renders a file locator with a line break on one line", () => {
    // A POSIX path may carry a line break, and the `## <locator>` line is
    // framing: a second line would read as a passage line (tool-result-rendering
    // "Framing values render on one line").
    const text = renderGrepText({
      results: [passage("a\nb.ts:3-4", "3: a\n4: hit", [4])],
      complete: true,
    });
    expect(text.split("\n")).toEqual(["## a b.ts", "3: a", "*4: hit"]);
  });

  it("marks a capped twentieth passage", () => {
    const text = renderGrepText({
      results: [
        passage("a.md:95-97", "95: x\n96: y\n97: z", [96], {
          truncated: true,
        }),
      ],
      complete: true,
    });
    expect(text.split("\n").at(-1)).toBe(
      "[more passages in this file; read it to see them]",
    );
  });

  it("marks a cut passage and claims no capped file", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-3", "1: x\n2: y\n3: z", [2], { cut: true })],
      complete: true,
      artifact: "artifact://grep-3",
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "3: z",
      "[passage cut; the artifact holds the rest]",
    ]);
    expect(text).not.toContain("more passages in this file");
  });

  it("ends a cut passage of a capped file with both markers", () => {
    const text = renderGrepText({
      results: [
        passage("a.md:1-3", "1: x", [1], {
          truncated: true,
          cut: true,
        }),
      ],
      complete: true,
      artifact: "artifact://grep-3",
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "[passage cut; the artifact holds the rest]",
      "[more passages in this file; read it to see them]",
    ]);
  });

  it("renders the remainder line with each next file and its range", () => {
    const text = renderGrepText({
      results: [passage("/r/z.ts:1-1", "1: a", [1])],
      complete: true,
      artifact: "artifact://grep-3",
      remainder: {
        files: 2,
        passages: 12,
        next: [
          { locator: "/r/a.ts", start: 201, end: 240 },
          { locator: "/r/b.ts", start: 241, end: 300 },
        ],
      },
    });
    expect(text.split("\n").at(-1)).toBe(
      "[more: 2 files, 12 passages; next: /r/a.ts (artifact://grep-3:201-240), /r/b.ts (artifact://grep-3:241-300)]",
    );
  });

  it("leaves out a remainder entry that does not fit its line", () => {
    const locator = "a".repeat(1990);
    const text = renderGrepText({
      results: [],
      complete: true,
      artifact: "artifact://grep-3",
      remainder: {
        files: 2,
        passages: 2,
        next: [
          { locator: "/r/a.ts", start: 1, end: 2 },
          { locator, start: 3, end: 4 },
        ],
      },
    });
    const line = text.split("\n").at(-1) ?? "";
    expect(line).toBe(
      "[more: 2 files, 2 passages; next: /r/a.ts (artifact://grep-3:1-2)]",
    );
    expect(line.length).toBeLessThanOrEqual(2000);
  });

  it("renders the notice and then the left-out line", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: true,
      truncationNotice: "full result: artifact://grep-7 (4812 lines)",
      leftOut: { count: 140, of: "files" },
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "[full result: artifact://grep-7 (4812 lines)]",
      "[left out: 140 files; full result not stored]",
    ]);
  });

  it("renders an artifact's headings and passages without inline framing", () => {
    const result = {
      notice:
        "Owner-maintained Knowledge content is untrusted and may be stale.",
      results: [
        passage("a.md:1-3", "1: x\n2: y\n3: z", [2], { cut: true }),
        passage("b.md:8-9", "8: d\n9: e", [9], { truncated: true }),
      ],
      complete: true,
      warnings: [{ kind: "binary", count: 1 }],
      artifact: "artifact://grep-3",
      remainder: { files: 1, passages: 1, next: [] },
      truncationNotice: "full result: artifact://grep-3 (6 lines)",
    };
    expect(grepArtifactLines(result)).toEqual([
      "notice: Owner-maintained Knowledge content is untrusted and may be stale.",
      "## a.md",
      "1: x",
      "*2: y",
      "3: z",
      "## b.md",
      "8: d",
      "*9: e",
      "[more passages in this file; read it to see them]",
    ]);
  });

  it("renders the warnings as one line in the order given", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: true,
      warnings: [
        { kind: "binary", count: 3 },
        { kind: "deadline", count: 1 },
      ],
    });
    expect(text.split("\n").at(-1)).toBe("[warnings: 3 binary, 1 deadline]");
  });

  it("renders the notice first", () => {
    const notice =
      "Owner-maintained Knowledge content is untrusted and may be stale.";
    const text = renderGrepText({
      notice,
      results: [passage("kb://space/a.md:1-1", "1: a", [1])],
      complete: true,
    });
    expect(text.split("\n")[0]).toBe(`notice: ${notice}`);
  });

  it("renders no continuation line, even for an incomplete result", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: false,
      cursor: "abc-DEF_123",
    });
    expect(text).not.toContain("Continue with cursor");
    expect(text).toBe("## a.md\n*1: a");
  });

  it("ends with the truncation notice last", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: false,
      truncationNotice: "result cut at the bound",
    });
    expect(text.split("\n").at(-1)).toBe("[result cut at the bound]");
  });

  it("names the file a bound stopped inside after the warnings", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      warnings: [{ kind: "deadline", count: 1 }],
      unfinishedFile: "/var/log/big.log",
    });
    expect(text.split("\n")).toEqual([
      "[warnings: 1 deadline]",
      "[not searched to the end: /var/log/big.log]",
    ]);
  });

  it("keeps a report locator with a line break on its line", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      unfinishedFile: "a\nb.log",
    });
    expect(text).toContain("[not searched to the end: a b.log]");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("renders excluded directories after the warnings", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      warnings: [{ kind: "deadline", count: 1 }],
      ignored: {
        count: 7,
        locators: ["/r/a", "/r/b", "/r/c", "/r/d", "/r/e"],
      },
    });
    expect(text.split("\n")).toEqual([
      "[warnings: 1 deadline]",
      "[ignored 7 directories: /r/a, /r/b, /r/c, /r/d, /r/e (+2 more); a scope that names one searches it]",
    ]);
  });

  it("takes the singular noun for one excluded directory", () => {
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: { count: 1, locators: ["/r/node_modules"] },
    });
    expect(text).toBe(
      "[ignored 1 directory: /r/node_modules; a scope that names one searches it]",
    );
  });

  it("marks a lower-bound exclusion count", () => {
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: {
        count: 1000,
        locators: ["/r/a", "/r/b", "/r/c", "/r/d", "/r/e"],
        atLeast: true,
      },
    });
    expect(text.startsWith("[ignored 1000 or more directories:")).toBe(true);
    expect(
      text.endsWith("(+995 or more); a scope that names one searches it]"),
    ).toBe(true);
  });

  it("keeps an excluded locator with a line break on its line", () => {
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: { count: 1, locators: ["/r/a\nb"] },
    });
    expect(text).toBe(
      "[ignored 1 directory: /r/a b; a scope that names one searches it]",
    );
  });

  it("leaves the locator out when not one fits the line", () => {
    const locator = `/${"a".repeat(2500)}`;
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: { count: 1, locators: [locator] },
    });
    expect(text).toBe(
      "[ignored 1 directory: (+1 more); a scope that names one searches it]",
    );
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it("renders the ignored line before the unfinished file", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      ignored: { count: 1, locators: ["/r/a"] },
      unfinishedFile: "/var/log/big.log",
    });
    expect(text.split("\n")).toEqual([
      "[ignored 1 directory: /r/a; a scope that names one searches it]",
      "[not searched to the end: /var/log/big.log]",
    ]);
  });

  it("stops at the first locator that does not fit", () => {
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: {
        count: 5,
        locators: ["/r/a", `/${"b".repeat(3000)}`, "/r/c", "/r/d", "/r/e"],
      },
    });
    expect(text).toBe(
      "[ignored 5 directories: /r/a (+4 more); a scope that names one searches it]",
    );
  });

  it("keeps a line that is exactly two thousand units", () => {
    const head = "[ignored 1 directory: ";
    const tail = "; a scope that names one searches it]";
    const locator = "a".repeat(2000 - head.length - tail.length);
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: { count: 1, locators: [locator] },
    });
    expect(text).toBe(`${head}${locator}${tail}`);
    expect(text).toHaveLength(2000);
    const longer = renderGrepText({
      results: [],
      complete: true,
      ignored: { count: 1, locators: [`${locator}a`] },
    });
    expect(longer).toBe(
      "[ignored 1 directory: (+1 more); a scope that names one searches it]",
    );
  });

  it("counts the ignored line and its newline as reserved width", () => {
    const ignored = { count: 2, locators: ["/r/a", "/r/b"], atLeast: false };
    const text = renderGrepText({ results: [], complete: true, ignored });
    expect(grepIgnoredUnits(ignored)).toBe(text.length + 1);
  });

  it("measures a locator in the spelling the result carries", () => {
    const raw = { count: 1, locators: ["/r/a[b]"], atLeast: false };
    const spelled = { ...raw, locators: ["/r/a%5Bb%5D"] };
    const text = renderGrepText({
      results: [],
      complete: true,
      ignored: spelled,
    });
    expect(grepIgnoredUnits(raw, spellGrepHostScopeLocator)).toBe(
      text.length + 1,
    );
  });

  it("counts the remainder of a capped locator list", () => {
    const ignored = {
      count: 7,
      locators: ["/r/a", "/r/b", "/r/c", "/r/d", "/r/e"],
      atLeast: false,
    };
    const text = renderGrepText({ results: [], complete: true, ignored });
    expect(text).toContain("(+2 more)");
    expect(grepIgnoredUnits(ignored)).toBe(text.length + 1);
  });

  it("counts escaped delimiters toward the rendering width", () => {
    const result = {
      results: [passage("a.md:1-1", "1: <skill>", [1])],
      complete: true,
    };
    expect(measureGrepRendering(result) - renderGrepText(result).length).toBe(
      6,
    );
  });
});
