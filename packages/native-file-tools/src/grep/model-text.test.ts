import {
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

  it("marks a passage the page cut as a cut, not as a capped file", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-3", "1: x\n2: y\n3: z", [2], { cut: true })],
      complete: true,
    });
    expect(text).toBe(
      "## a.md\n1: x\n*2: y\n3: z\n[passage cut at the result bound; continue with the cursor]",
    );
    expect(text).not.toContain("more passages in this file");
  });

  it("ends a cut passage of a capped file with the cap marker", () => {
    const text = renderGrepText({
      results: [
        passage("a.md:1-3", "1: x", [1], {
          truncated: true,
          cut: true,
        }),
      ],
      complete: true,
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "[passage cut at the result bound; continue with the cursor]",
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

  it("ends a continuing page with its cursor and a complete one without", () => {
    const continuing = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: false,
      cursor: "abc-DEF_123",
    });
    expect(continuing.split("\n").at(-1)).toBe(
      "[more results. Continue with cursor: abc-DEF_123]",
    );
    const complete = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: true,
    });
    expect(complete).not.toContain("Continue with cursor");
  });

  it("ends with the cut notice last", () => {
    const text = renderGrepText({
      results: [passage("a.md:1-1", "1: a", [1])],
      complete: false,
      cursor: "c",
      truncationNotice: "result cut at the bound",
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "[more results. Continue with cursor: c]",
      "[result cut at the bound]",
    ]);
  });

  it("names the file a bound stopped inside after the warnings", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      cursor: "c",
      warnings: [{ kind: "deadline", count: 1 }],
      unfinishedFile: "/var/log/big.log",
    });
    expect(text.split("\n")).toEqual([
      "[warnings: 1 deadline]",
      "[not searched to the end: /var/log/big.log]",
      "[more results. Continue with cursor: c]",
    ]);
  });

  it("keeps a report locator with a line break on its line", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      cursor: "c",
      unfinishedFile: "a\nb.log",
    });
    expect(text).toContain("[not searched to the end: a b.log]");
    expect(text.split("\n")).toHaveLength(2);
  });

  it("renders excluded directories after the warnings", () => {
    const text = renderGrepText({
      results: [],
      complete: false,
      cursor: "c",
      warnings: [{ kind: "deadline", count: 1 }],
      ignored: {
        count: 7,
        locators: ["/r/a", "/r/b", "/r/c", "/r/d", "/r/e"],
      },
    });
    expect(text.split("\n")).toEqual([
      "[warnings: 1 deadline]",
      "[ignored 7 directories: /r/a, /r/b, /r/c, /r/d, /r/e (+2 more); a scope that names one searches it]",
      "[more results. Continue with cursor: c]",
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
      cursor: "c",
      ignored: { count: 1, locators: ["/r/a"] },
      unfinishedFile: "/var/log/big.log",
    });
    expect(text.split("\n")).toEqual([
      "[ignored 1 directory: /r/a; a scope that names one searches it]",
      "[not searched to the end: /var/log/big.log]",
      "[more results. Continue with cursor: c]",
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
