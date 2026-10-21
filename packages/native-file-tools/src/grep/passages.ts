import { renderSourceLine, splitSourceLines } from "../source-lines";
import { GREP_LIMITS } from "./limits";
import type { CompiledGrepPatterns } from "./patterns";
import type { GrepPassage } from "./types";

/** Logical lines between cooperative yields. */
const YIELD_LINES = 256;

/** A merged window: one-based inclusive lines plus their matched lines. */
type GrepInterval = { start: number; end: number; matches: Array<number> };

/**
 * Every passage one file contributes, in canonical order. Logical lines
 * follow the native read rules, a window is one line each side, and a merged
 * interval longer than the passage cap is partitioned after its last matched
 * line within the first 2,000 lines of each remainder.
 */
export async function grepFilePassages(
  fileLocator: string,
  text: string,
  patterns: CompiledGrepPatterns,
): Promise<Array<GrepPassage>> {
  const lines = splitSourceLines(text).map((line) =>
    line.endsWith("\r\n")
      ? line.slice(0, -2)
      : line.endsWith("\n")
        ? line.slice(0, -1)
        : line,
  );
  const passages: Array<GrepPassage> = [];
  for (const interval of mergeWindows(
    lines.length,
    await matchLines(lines, patterns),
  )) {
    partitionInterval(interval, (start, end, matches) => {
      passages.push(renderPassage(fileLocator, lines, { start, end, matches }));
    });
  }
  return passages;
}

/** One-based start line of an emitted passage locator. */
export function passageStartLine(locator: string): number {
  return Number(locator.slice(locator.lastIndexOf(":") + 1).split("-")[0]);
}

async function matchLines(
  lines: ReadonlyArray<string>,
  patterns: CompiledGrepPatterns,
): Promise<Array<number>> {
  const matched: Array<number> = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0 && index % YIELD_LINES === 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
    if (patterns.matches(line)) matched.push(index + 1);
  }
  return matched;
}

function mergeWindows(
  lineCount: number,
  matched: ReadonlyArray<number>,
): Array<GrepInterval> {
  const intervals: Array<GrepInterval> = [];
  for (const line of matched) {
    const start = Math.max(1, line - GREP_LIMITS.contextLines);
    const end = Math.min(lineCount, line + GREP_LIMITS.contextLines);
    const last = intervals.at(-1);
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      last.matches.push(line);
      continue;
    }
    intervals.push({ start, end, matches: [line] });
  }
  return intervals;
}

function partitionInterval(
  interval: GrepInterval,
  emit: (start: number, end: number, matches: ReadonlyArray<number>) => void,
): void {
  let start = interval.start;
  let index = 0;
  while (start <= interval.end) {
    while (index < interval.matches.length && interval.matches[index] < start)
      index += 1;
    if (index >= interval.matches.length) return;
    if (interval.end - start + 1 <= GREP_LIMITS.passageLines) {
      emit(start, interval.end, interval.matches.slice(index));
      return;
    }
    const limitEnd = start + GREP_LIMITS.passageLines - 1;
    let cut = index;
    while (
      cut + 1 < interval.matches.length &&
      interval.matches[cut + 1] <= limitEnd
    )
      cut += 1;
    emit(start, interval.matches[cut], interval.matches.slice(index, cut + 1));
    start = interval.matches[cut] + 1;
    index = cut + 1;
  }
}

function renderPassage(
  fileLocator: string,
  lines: ReadonlyArray<string>,
  window: {
    readonly start: number;
    readonly end: number;
    readonly matches: ReadonlyArray<number>;
  },
): GrepPassage {
  const content: Array<string> = [];
  for (let line = window.start; line <= window.end; line += 1) {
    const source = lines[line - 1];
    const cut =
      source.length > GREP_LIMITS.lineCodeUnits
        ? `${source.slice(0, GREP_LIMITS.lineCodeUnits)}…`
        : source;
    content.push(renderSourceLine(cut, line - 1));
  }
  return {
    locator: `${fileLocator}:${window.start}-${window.end}`,
    content: content.join("\n"),
    matches: window.matches,
  };
}
