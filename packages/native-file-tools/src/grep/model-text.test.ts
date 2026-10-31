import { measureGrepRendering, renderGrepText } from "./model-text";

/** One stored passage of the fixture page. */
function passage(
  locator: string,
  content: string,
  matches: ReadonlyArray<number>,
  truncated = false,
) {
  return {
    locator,
    content,
    matches,
    ...(truncated && { truncated: true as const }),
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

  it("marks a capped twentieth passage", () => {
    const text = renderGrepText({
      results: [passage("a.md:95-97", "95: x\n96: y\n97: z", [96], true)],
      complete: true,
    });
    expect(text.split("\n").at(-1)).toBe(
      "[more passages in this file; read it to see them]",
    );
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
