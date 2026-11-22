import { formatLineRange } from "../path";

/** The range a passage locator ends with: `L<start>-<end>`, or a stored bare one. */
const PASSAGE_RANGE = /^[Ll]?(\d+)-(\d+)$/u;

/** A passage locator's file, without the line range it ends with. */
export interface ParsedPassageLocator {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** `<file>:L<start>-<end>` — a passage locator in the canonical spelling. */
export function formatPassageLocator(
  file: string,
  startLine: number,
  endLine: number,
): string {
  return `${file}:${formatLineRange(startLine, endLine)}`;
}

/**
 * Splits a passage locator in either spelling (`file:5-10` or `file:L5-10`).
 * Only the last colon may separate the range, because a path can carry one,
 * and a stored locator keeps the spelling it was written with. Anything else
 * at the end is no passage range, so the call returns none.
 */
export function parsePassageLocator(
  locator: string,
): ParsedPassageLocator | undefined {
  const separator = locator.lastIndexOf(":");

  if (separator === -1) return undefined;
  const range = PASSAGE_RANGE.exec(locator.slice(separator + 1));

  if (range === null) return undefined;

  return {
    file: locator.slice(0, separator),
    startLine: Number(range[1]),
    endLine: Number(range[2]),
  };
}
