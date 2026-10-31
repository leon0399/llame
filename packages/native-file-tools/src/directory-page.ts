import { measureReadRendering } from "./source-lines";
import type { DirectoryFailure, DirectorySuccess } from "./directory-listing";

/** A rendered page and the bookkeeping its caller stores beside it. */
export type DirectoryPage = {
  content: string;
  truncated: boolean;
  nextOffset?: number;
};

/** The width the model receives for a listing page, against the shared cap. */
export function fitsResultCap(
  candidate: DirectorySuccess,
  cap: number,
): boolean {
  return measureReadRendering(candidate) <= cap;
}

/**
 * The refusal a listing returns when no page of it fits the cap. A page that
 * keeps no entry carries the `nextOffset` it was asked from, so its
 * continuation names the entry it already selected and every retry returns
 * the same page; the listing fails closed instead of stalling.
 */
export function listingTooLarge(firstEntry: boolean): DirectoryFailure {
  return {
    status: "error",
    type: "representation_too_large",
    message: firstEntry
      ? "The listing's header and its next entry exceed the result bound, so no page of the listing can be shown."
      : "The listing's header alone exceeds the result bound, so the listing cannot be shown.",
  };
}

/** One listing page, carrying the requested level's entry count whichever
 *  slice of it the page shows. */
export function directoryResult(
  targetPath: string,
  entryCount: number,
  page: DirectoryPage,
): DirectorySuccess {
  const result: DirectorySuccess = {
    status: "success",
    kind: "directory",
    path: targetPath,
    content: page.content,
    truncated: page.truncated,
    entryCount,
  };
  if (page.nextOffset !== undefined) result.nextOffset = page.nextOffset;
  return result;
}

/**
 * A flat slice cut to the shared cap: the page keeps as many whole entry lines
 * as fit, and the continuation points at the first entry the page no longer
 * shows. The width grows with each kept entry line, so the largest page that
 * fits is found by binary search rather than one entry per re-render.
 */
export function boundFlatResult(
  result: DirectorySuccess,
  requestOffset: number,
  cap: number,
): DirectorySuccess | DirectoryFailure {
  if (fitsResultCap(result, cap)) return result;

  const lines = result.content.split("\n");
  const header = lines[0] ?? "";
  const entries = lines.slice(1).filter((line) => line.length > 0);
  const page = (kept: number): DirectorySuccess => ({
    ...result,
    content: [header, ...entries.slice(0, kept)].join("\n") + "\n",
    truncated: true,
    nextOffset: requestOffset + kept,
  });
  // A page that keeps no entry names the entry it already selected, so the
  // continuation would return it again. The smallest page that keeps one entry
  // is the last chance to advance, and a requested window with no entry to
  // keep has none at all: both fail closed rather than stall.
  if (entries.length === 0) return listingTooLarge(false);
  if (!fitsResultCap(page(1), cap)) return listingTooLarge(true);
  let low = 1;
  let high = entries.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsResultCap(page(middle), cap)) low = middle;
    else high = middle - 1;
  }
  return page(low);
}
