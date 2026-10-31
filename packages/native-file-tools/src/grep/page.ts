import { grepContinuationUnits } from "./cursor";
import { grepPassageUnits } from "./model-text";
import { passageEndLine, passageStartLine } from "./passages";
import type { GrepPassage } from "./types";

/** The passage a page ends at; the next call resumes after it. */
export interface GrepPageKey {
  readonly scopeIndex: number;
  readonly rel: string;
  readonly startLine: number;
  /** Last line the page emitted of that passage; present only when it cut it. */
  readonly endLine?: number;
  /** The named passage was its file's twentieth, so the file is exhausted. */
  readonly capped: boolean;
}

/** Page state threaded through one call's emission. */
export interface GrepPage {
  readonly results: Array<GrepPassage>;
  /** Files that contributed at least one passage to this page. */
  files: number;
  /** The page holds no more; the walk stops here. */
  full: boolean;
  last: GrepPageKey | undefined;
  /**
   * Rendered width of the widest position cursor's continuation line any walk
   * of this page reached. A stop before a passage can end the page, so the
   * room is kept.
   */
  reserveFloor: number;
  /** Rendered width of `results` as a complete page, kept as they grow. */
  units: number;
}

/** What a page may render to, and what it must leave for its caller. */
export interface GrepPageLimits {
  /** The whole page's bound, its own lines and the cursor included. */
  readonly pageUnits: number;
  /** Rendered width of the caller's result fields beside the passages. */
  readonly fixedReserve: number;
}

/** One file's passages and the cap that hides the rest of that file. */
export interface GrepFileEmission {
  readonly scopeIndex: number;
  readonly rel: string;
  readonly fileLocator: string;
  readonly passages: ReadonlyArray<GrepPassage>;
  /** Start line of the twentieth passage when the file holds more than 20. */
  readonly cappedAt: number | undefined;
}

export function createGrepPage(): GrepPage {
  return {
    results: [],
    files: 0,
    full: false,
    last: undefined,
    reserveFloor: 0,
    units: 0,
  };
}

/**
 * Append one file's passages while the page holds them. A passage is admitted
 * only when its rendered text, the continuation line of the cursor that names
 * it, the caller's fixed fields, and the longest position cursor reached so
 * far all fit, so the page never overflows and never needs a second walk. A
 * passage that does not fit ends the page; when it is the page's first, it is
 * cut at a line boundary so the page never returns an empty result for a real
 * match. The count of passages appended is returned, so a caller can tell
 * which of them the page kept.
 */
export function appendGrepFile(
  page: GrepPage,
  limits: GrepPageLimits,
  emission: GrepFileEmission,
): number {
  let emitted = 0;
  for (const passage of emission.passages) {
    const added = grepPassageUnits(page.results.at(-1), passage);
    if (fits(page, limits, pageKey(emission, passage), added)) {
      page.results.push(passage);
      page.units += added;
      emitted += 1;
      page.last = pageKey(emission, passage);
      continue;
    }
    if (page.results.length === 0) {
      const cut = cutToFit(page, limits, emission, passage);
      page.units += grepPassageUnits(page.results.at(-1), cut);
      page.results.push(cut);
      emitted += 1;
      page.last = {
        ...pageKey(emission, cut),
        endLine: passageEndLine(cut.locator),
      };
    }
    page.full = true;
    break;
  }
  if (emitted > 0) page.files += 1;
  return emitted;
}

/**
 * Whether one more result fits the page: the passages it already holds, the
 * widening this one adds, the continuation line that names it, and the room
 * the caller's own lines take. A page that ends before its first passage keeps
 * the room of the position cursor that then carries it.
 */
function fits(
  page: GrepPage,
  limits: GrepPageLimits,
  key: GrepPageKey,
  added: number,
): boolean {
  const reserve = Math.max(grepContinuationUnits(key), page.reserveFloor);
  return page.units + added + reserve + limits.fixedReserve <= limits.pageUnits;
}

function pageKey(
  emission: GrepFileEmission,
  passage: GrepPassage,
): GrepPageKey {
  const startLine = passageStartLine(passage.locator);
  return {
    scopeIndex: emission.scopeIndex,
    rel: emission.rel,
    startLine,
    capped: emission.cappedAt === startLine,
  };
}

/** Keep leading lines until the passage, its cursor, and the page all fit. */
function cutToFit(
  page: GrepPage,
  limits: GrepPageLimits,
  emission: GrepFileEmission,
  passage: GrepPassage,
): GrepPassage {
  const [start, rangeEnd] = passage.locator
    .slice(passage.locator.lastIndexOf(":") + 1)
    .split("-")
    .map(Number);
  const lines = passage.content.split("\n");
  const cutAt = (end: number): GrepPassage => ({
    locator: `${emission.fileLocator}:${start}-${end}`,
    content: lines.slice(0, end - start + 1).join("\n"),
    matches: passage.matches.filter((line) => line <= end),
    cut: true,
    // The cap marker belongs to the file's twentieth passage alone; the cut
    // ends the page and the cursor continues it.
    ...(emission.cappedAt === start && { truncated: true as const }),
  });
  // A cut passage ends the page, so its cursor names its last emitted line.
  for (let end = rangeEnd; end > start; end -= 1) {
    const cut = cutAt(end);
    const key = { ...pageKey(emission, cut), endLine: end };
    if (fits(page, limits, key, grepPassageUnits(page.results.at(-1), cut)))
      return cut;
  }
  // One line is the floor: a match never yields an empty page.
  return cutAt(start);
}
