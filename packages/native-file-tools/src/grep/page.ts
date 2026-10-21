import { measureNativeModelOutput } from "../serialization";
import { passageStartLine } from "./passages";
import type { GrepPassage } from "./types";

/** The passage a page ends at; the next call resumes after it. */
export interface GrepPageKey {
  readonly scopeIndex: number;
  readonly rel: string;
  readonly startLine: number;
  /** The named passage was its file's twentieth, so the file is exhausted. */
  readonly capped: boolean;
}

/** Page state threaded through one call's emission. */
export interface GrepPage {
  readonly results: Array<GrepPassage>;
  /** Serialized units of `results`, brackets included. */
  units: number;
  /** Files that contributed at least one passage to this page. */
  files: number;
  /** The page holds no more; the walk stops here. */
  full: boolean;
  last: GrepPageKey | undefined;
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
  return { results: [], units: 2, files: 0, full: false, last: undefined };
}

/**
 * Append one file's passages while the page holds them. A passage that does
 * not fit ends the page; when it is the page's first, it is cut at a line
 * boundary so the page never returns an empty result for a real match.
 */
export function appendGrepFile(
  page: GrepPage,
  limit: number,
  emission: GrepFileEmission,
): void {
  let emitted = 0;
  for (const passage of emission.passages) {
    const element = measurePassage(passage);
    const separator = page.results.length === 0 ? 0 : 1;
    if (page.units + separator + element <= limit) {
      page.results.push(passage);
      page.units += separator + element;
      emitted += 1;
      page.last = pageKey(emission, passage);
      continue;
    }
    if (page.results.length === 0) {
      const cut = cutToFit(emission.fileLocator, passage, limit - page.units);
      page.results.push(cut);
      page.units += measurePassage(cut);
      emitted += 1;
      page.last = { ...pageKey(emission, cut), capped: false };
    }
    page.full = true;
    break;
  }
  if (emitted > 0) page.files += 1;
}

/** An array of one element serializes as `[` + element + `]`. */
function measurePassage(passage: GrepPassage): number {
  return measureNativeModelOutput(passage) - 2;
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

/** Keep leading lines until the passage fits the room left on the page. */
function cutToFit(
  fileLocator: string,
  passage: GrepPassage,
  room: number,
): GrepPassage {
  const [start, rangeEnd] = passage.locator
    .slice(passage.locator.lastIndexOf(":") + 1)
    .split("-")
    .map(Number);
  const lines = passage.content.split("\n");
  let end = rangeEnd;
  let cut: GrepPassage = { ...passage, truncated: true };
  while (end > start && measurePassage(cut) > room) {
    end -= 1;
    cut = {
      locator: `${fileLocator}:${start}-${end}`,
      content: lines.slice(0, end - start + 1).join("\n"),
      matches: passage.matches.filter((line) => line <= end),
      truncated: true,
    };
  }
  return cut;
}
