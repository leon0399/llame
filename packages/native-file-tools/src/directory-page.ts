import { measureReadRendering } from "./source-lines";
import type { DirectorySuccess } from "./directory-listing";

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
): DirectorySuccess {
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
  if (entries.length === 0) return page(0);
  let low = 0;
  let high = entries.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsResultCap(page(middle), cap)) low = middle;
    else high = middle - 1;
  }
  return page(low);
}
