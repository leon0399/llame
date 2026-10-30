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
 * A flat slice cut to the shared cap: whole entry lines are dropped from the
 * end until the page fits, and the continuation points at the first entry the
 * page no longer shows.
 */
export function boundFlatResult(
  result: DirectorySuccess,
  requestOffset: number,
  cap: number,
): DirectorySuccess {
  if (fitsResultCap(result, cap)) return result;

  const lines = result.content.split("\n");
  const keptEntries = () =>
    lines.slice(1).filter((line) => line.length > 0).length;
  const page = (): DirectorySuccess => ({
    ...result,
    content: lines.join("\n") + "\n",
    truncated: true,
    nextOffset: requestOffset + keptEntries(),
  });
  while (lines.length > 1 && !fitsResultCap(page(), cap)) lines.pop();
  return { ...result, ...page() };
}
