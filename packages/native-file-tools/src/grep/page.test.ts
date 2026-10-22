import { measureNativeModelOutput } from "../serialization";

import { encodeGrepCursor, grepCursorFieldUnits } from "./cursor";
import { appendGrepFile, createGrepPage, type GrepFileEmission } from "./page";
import type { GrepPassage } from "./types";

/** The cursor field of a page that ends at line 40 of `a.md`. */
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

/** One passage's code units inside the results array, brackets aside. */
function elementOf(passage: GrepPassage): number {
  return measureNativeModelOutput(passage) - 2;
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
  it("sizes the cursor field as the encoded cursor beside its key", () => {
    const encoded = encodeGrepCursor({ ...KEY, inputHash: "f".repeat(64) });
    expect(grepCursorFieldUnits(KEY)).toBe(encoded.length + 12);
  });

  it("admits a passage only when its cursor and the fixed fields fit", () => {
    const pageUnits = 2 + elementOf(FIRST) + grepCursorFieldUnits(KEY) + 100;

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
    const pageUnits = 2 + elementOf(FIRST) + 900;
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
});
