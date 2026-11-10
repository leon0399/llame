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
  it("keeps the cap and the cut apart when it cuts a capped first passage", () => {
    const page = createGrepPage();
    appendGrepFile(
      page,
      { pageUnits: 10, fixedReserve: 0 },
      emission([FIRST], 40),
    );
    expect(page.results).toHaveLength(1);
    expect(page.results[0]).toMatchObject({ cut: true, truncated: true });
    expect(page.full).toBe(true);
    expect(page.last).toMatchObject({
      startLine: 40,
      endLine: 40,
      capped: true,
    });
  });

  it("marks a cut passage that is not its file's twentieth as a cut only", () => {
    const page = createGrepPage();
    appendGrepFile(page, { pageUnits: 10, fixedReserve: 0 }, emission([FIRST]));
    expect(page.results).toHaveLength(1);
    expect(page.results[0].cut).toBe(true);
    expect(page.results[0].truncated).toBeUndefined();
    expect(page.last).toMatchObject({
      startLine: 40,
      endLine: 40,
      capped: false,
    });
  });
});

describe("grep page held content", () => {
  it("ends the page at an incomplete passage after a complete one", () => {
    const page = createGrepPage();
    appendGrepFile(
      page,
      { pageUnits: 60_000, fixedReserve: 0 },
      emission([FIRST, { ...SECOND, incomplete: true }]),
    );
    expect(page.results).toEqual([FIRST]);
    expect(page.full).toBe(true);
    expect(page.last).toMatchObject({ startLine: 40 });
  });

  it("cuts a passage the scan only partly holds, however wide the page", () => {
    const page = createGrepPage();
    appendGrepFile(
      page,
      { pageUnits: 60_000, fixedReserve: 0 },
      emission([{ ...FIRST, incomplete: true }]),
    );
    expect(page.results).toHaveLength(1);
    expect(page.results[0].cut).toBe(true);
    expect(page.results[0].incomplete).toBeUndefined();
    expect(page.last).toMatchObject({ startLine: 40, endLine: 40 });
    expect(page.full).toBe(true);
  });
});

describe("grep page reservation", () => {
  it("sizes the reservation as a real cursor's continuation line", () => {
    // The reserve is the width of the line a real encoded cursor renders to,
    // its separating newline included; the page never renders it, but the
    // engine keeps that room back before it admits a passage.
    const cursor = encodeGrepCursor({ ...KEY, inputHash: "f".repeat(64) });
    expect(grepContinuationUnits(KEY)).toBe(
      `[more results. Continue with cursor: ${cursor}]\n`.length,
    );
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
    expect(overflows.results[0].cut).toBe(true);
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
    // The page holds its passage and keeps the reserve for its unseen resume
    // point: together they land exactly on the bound.
    expect(
      renderGrepText({ results: exact.results, complete: false }).length +
        reserve,
    ).toBe(GREP_LIMITS.pageCodeUnits);

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
    expect(over.results[0].cut).toBe(true);
    expect(over.full).toBe(true);
  });
});
