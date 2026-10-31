import { encodeGrepCursor, grepContinuationUnits } from "./cursor";
import { GREP_LIMITS } from "./limits";
import { renderGrepText } from "./model-text";
import { appendGrepFile, createGrepPage, type GrepFileEmission } from "./page";
import type { GrepPassage } from "./types";

/** The cursor point of a page that ends at line 40 of `a.md`. */
const KEY = { scopeIndex: 0, rel: "a.md", startLine: 40, capped: false };

const FIRST: GrepPassage = {
  locator: "/repo/a.md:40-40",
  content: "40: hit",
  matches: [40],
};

const SECOND: GrepPassage = {
  locator: "/repo/a.md:50-50",
  content: "50: hit",
  matches: [50],
};

/** The rendered width of these passages, with no cursor and no caller lines. */
function renderedWidth(passages: ReadonlyArray<GrepPassage>): number {
  return renderGrepText({ results: passages, complete: true }).length;
}

function emission(
  passages: ReadonlyArray<GrepPassage>,
  cappedAt?: number,
): GrepFileEmission {
  return {
    scopeIndex: 0,
    rel: "a.md",
    fileLocator: "/repo/a.md",
    passages,
    cappedAt,
  };
}

describe("grep page cuts", () => {
  it("keeps the twentieth-passage flag when it cuts the first passage", () => {
    const page = createGrepPage();
    appendGrepFile(
      page,
      { pageUnits: 10, fixedReserve: 0 },
      emission([FIRST], 40),
    );
    expect(page.results).toHaveLength(1);
    expect(page.results[0].truncated).toBe(true);
    expect(page.full).toBe(true);
    expect(page.last).toMatchObject({
      startLine: 40,
      endLine: 40,
      capped: true,
    });
  });
});

describe("grep page reservation", () => {
  it("sizes the reservation as the cursor's rendered continuation line", () => {
    const cursor = encodeGrepCursor({ ...KEY, inputHash: "f".repeat(64) });
    const complete = renderGrepText({ results: [FIRST], complete: true });
    const continued = renderGrepText({
      results: [FIRST],
      complete: false,
      cursor,
    });
    expect(grepContinuationUnits(KEY)).toBe(continued.length - complete.length);
  });

  it("admits a passage only when its text and the fixed fields fit", () => {
    const pageUnits = renderedWidth([FIRST]) + grepContinuationUnits(KEY) + 100;

    const fits = createGrepPage();
    appendGrepFile(fits, { pageUnits, fixedReserve: 100 }, emission([FIRST]));
    expect(fits.results).toHaveLength(1);
    expect(fits.full).toBe(false);

    const overflows = createGrepPage();
    appendGrepFile(
      overflows,
      { pageUnits: pageUnits - 1, fixedReserve: 100 },
      emission([FIRST]),
    );
    expect(overflows.results[0].locator).toBe(FIRST.locator);
    expect(overflows.results[0].truncated).toBe(true);
    expect(overflows.full).toBe(true);
  });

  it("keeps the room of a position cursor reached before any passage", () => {
    // Two one-line passages would both fit; the position cursor's room makes
    // the second wait for the next call.
    const pageUnits = renderedWidth([FIRST]) + 900;
    const page = createGrepPage();
    page.reserveFloor = 900;
    appendGrepFile(
      page,
      { pageUnits, fixedReserve: 0 },
      emission([FIRST, SECOND]),
    );
    expect(page.results.map((passage) => passage.locator)).toEqual([
      FIRST.locator,
    ]);
    expect(page.full).toBe(true);
  });

  it("admits a page that renders to exactly the bound and one more unit overflows", () => {
    const limits = {
      pageUnits: GREP_LIMITS.pageCodeUnits,
      fixedReserve: 0,
    };
    const locator = "/repo/a.md:1-1";
    const reserve = grepContinuationUnits({
      scopeIndex: 0,
      rel: "a.md",
      startLine: 1,
    });
    const bare = renderGrepText({
      results: [{ locator, content: "1: ", matches: [1] }],
      complete: true,
    }).length;
    const passageOf = (extra: number): GrepPassage => ({
      locator,
      content: `1: ${"a".repeat(GREP_LIMITS.pageCodeUnits - reserve - bare + extra)}`,
      matches: [1],
    });

    const exact = createGrepPage();
    appendGrepFile(exact, limits, emission([passageOf(0)]));
    expect(exact.results).toHaveLength(1);
    expect(exact.results[0].truncated).toBeUndefined();
    expect(exact.full).toBe(false);
    const continued = renderGrepText({
      results: exact.results,
      complete: false,
      cursor: encodeGrepCursor({
        scopeIndex: 0,
        rel: "a.md",
        startLine: 1,
        inputHash: "f".repeat(64),
      }),
    });
    expect(continued.length).toBe(GREP_LIMITS.pageCodeUnits);

    // One more passage does not fit beside the exact page: it ends the page.
    appendGrepFile(
      exact,
      limits,
      emission([{ locator: "/repo/a.md:2-2", content: "2: b", matches: [2] }]),
    );
    expect(exact.results).toHaveLength(1);
    expect(exact.full).toBe(true);

    const over = createGrepPage();
    appendGrepFile(over, limits, emission([passageOf(1)]));
    expect(over.results[0].truncated).toBe(true);
    expect(over.full).toBe(true);
  });
});
