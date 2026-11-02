import {
  isNumber,
  isRecord,
  isString,
  neutralizeReservedDelimiters,
  type UnknownRecord,
} from "@workspace/runtime-safety";

import { isNonEmptyString, oneLine } from "../model-text";
import { GREP_LIMITS } from "./limits";
import { passageStartLine } from "./passages";
import type { GrepPassage } from "./types";

/*
 * The model-facing text of a `grep` page (tool-result-rendering "A grep page
 * groups consecutive passages under one file line"). Each run of consecutive
 * passages of one file renders under one `## <file locator>` line, passages of
 * one run are separated by one blank line, and a matched line carries the
 * `*N: text` prefix the stored passage already spells as `N: text`. A page
 * that continues ends with one bracketed line carrying its cursor.
 */

/** One stored passage, as the page's `results` list carries it. */
interface PassageView {
  /** The file's locator without its line range. */
  readonly file: string;
  /** The one-based start line of the passage. */
  readonly startLine: number;
  readonly content: string;
  readonly matches: ReadonlyArray<number>;
  /** The page cut the passage at a line boundary; the cursor continues it. */
  readonly cut: boolean;
  /** The passage is its file's twentieth: the file holds more after it. */
  readonly truncated: boolean;
}

/** The line a capped twentieth passage ends with: the file holds more, and a
 *  `read` is the only way to see them. */
const CAPPED_PASSAGE_MARKER =
  "[more passages in this file; read it to see them]";

/** The line a passage cut at the page bound ends with: the cursor continues
 *  it, and the lines after it are on the next page. */
const CUT_PASSAGE_MARKER =
  "[passage cut at the result bound; continue with the cursor]";

/** `N: text` from the start of one stored content line. */
const NUMBERED_LINE = /^(\d+): /u;

/** The range a passage locator ends with, which the file locator drops. */
const RANGE_SUFFIX = /^(\d+)-(\d+)$/u;

/**
 * The file locator of a passage locator: the stored locator with its
 * `:<start>-<end>` suffix removed. Only the last colon may separate the range,
 * because a path can carry one.
 */
export function grepFileLocator(locator: string): string {
  const separator = locator.lastIndexOf(":");
  if (separator === -1) return locator;
  return RANGE_SUFFIX.test(locator.slice(separator + 1))
    ? locator.slice(0, separator)
    : locator;
}

/** One stored passage, or none when the result entry is not a passage. */
function passageOf(value: unknown): PassageView | undefined {
  if (!isRecord(value)) return undefined;
  const { locator, content, matches, cut, truncated } = value;
  if (!isNonEmptyString(locator) || !isString(content)) return undefined;
  const startLine = passageStartLine(locator);
  return {
    file: grepFileLocator(locator),
    // A locator with no readable start line opens its own run, as a malformed
    // entry should.
    startLine: Number.isFinite(startLine) ? startLine : 0,
    content,
    matches: Array.isArray(matches)
      ? matches.filter((line): line is number => isNumber(line))
      : [],
    cut: cut === true,
    truncated: truncated === true,
  };
}

/** The passages a stored page lists, in page order, skipping malformed ones. */
function passagesOf(value: unknown): Array<PassageView> {
  if (!Array.isArray(value)) return [];
  const passages: Array<PassageView> = [];
  for (const entry of value) {
    const passage = passageOf(entry);
    if (passage !== undefined) passages.push(passage);
  }
  return passages;
}

/**
 * One passage's lines: the stored `N: text` lines with a `*` before the
 * number of a matched line, then the cut marker of a passage the page cut, and
 * the capped-passage marker of its file's twentieth.
 */
function passageLines(passage: PassageView): Array<string> {
  const matched = new Set(passage.matches);
  const stored = passage.content.replace(/\n$/u, "");
  const lines = stored === "" ? [] : stored.split("\n");
  const marked = lines.map((line) => {
    const match = NUMBERED_LINE.exec(line);
    if (match === null) return line;
    return matched.has(Number(match[1])) ? `*${line}` : line;
  });
  if (passage.cut) marked.push(CUT_PASSAGE_MARKER);
  if (passage.truncated) marked.push(CAPPED_PASSAGE_MARKER);
  return marked;
}

/** One `[warnings: <count> <kind>, …]` line, in the order the page gives. */
function warningsLine(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const warnings: Array<string> = [];
  for (const warning of value) {
    if (!isRecord(warning)) continue;
    const { kind, count } = warning;
    if (!isNonEmptyString(kind) || !isNumber(count) || count < 1) continue;
    warnings.push(`${String(count)} ${kind}`);
  }
  return warnings.length === 0
    ? undefined
    : `[warnings: ${warnings.join(", ")}]`;
}

/**
 * Rendered width of the `[warnings: …]` line and its separating newline. A
 * walk's counts only grow, so the page reserve grows with them (design D7):
 * an unbounded walk has no largest count to reserve in advance.
 */
export function grepWarningsUnits(
  warnings: ReadonlyMap<string, number>,
): number {
  const line = warningsLine(
    [...warnings].map(([kind, count]) => ({ kind, count })),
  );
  return line === undefined ? 0 : line.length + 1;
}

/** The one bracketed line that carries the cursor of a continuing page. */
export function grepContinuationLine(cursor: string): string {
  return `[more results. Continue with cursor: ${cursor}]`;
}

/** The one line that names a file a bound stopped inside before any progress. */
export function grepUnfinishedLine(locator: string): string {
  return `[not searched to the end: ${oneLine(locator)}]`;
}

/** The most code units one `[ignored …]` line may take. */
const IGNORED_LINE_UNITS = 2000;

/** One stored `ignored` field: the admitted count and its first locators. */
interface IgnoredView {
  readonly count: number;
  readonly locators: ReadonlyArray<string>;
  readonly atLeast: boolean;
}

/** The stored `ignored` field, or none when it is not one this build wrote. */
function ignoredOf(value: unknown): IgnoredView | undefined {
  if (!isRecord(value)) return undefined;
  const { count, locators, atLeast } = value;
  if (!isNumber(count) || count < 1 || !Array.isArray(locators))
    return undefined;
  const kept: Array<string> = [];
  for (const locator of locators) {
    if (!isNonEmptyString(locator)) return undefined;
    if (kept.length < GREP_LIMITS.ignoredLocators) kept.push(locator);
  }
  return { count, locators: kept, atLeast: atLeast === true };
}

/**
 * One `[ignored …]` line: the admitted count and the first locators that fit
 * in 2,000 code units. A count larger than the rendered locators follows them
 * as a remainder; when not even the first locator fits, the remainder follows
 * the colon.
 */
function grepIgnoredLine(ignored: IgnoredView): string {
  const count = ignored.atLeast
    ? `${String(ignored.count)} or more`
    : String(ignored.count);
  const noun = ignored.count === 1 ? "directory" : "directories";
  const head = `[ignored ${count} ${noun}: `;
  const tail = "; a scope that names one searches it]";
  const chosen: Array<string> = [];
  let line: string | undefined;
  for (const locator of ignored.locators) {
    const folded = oneLine(locator);
    const next = [...chosen, folded];
    const rest = ignored.count - next.length;
    const candidate = `${head}${next.join(", ")}${
      rest > 0
        ? ` (+${String(rest)}${ignored.atLeast ? " or more" : " more"})`
        : ""
    }${tail}`;
    if (candidate.length > IGNORED_LINE_UNITS) break;
    chosen.push(folded);
    line = candidate;
  }
  if (line !== undefined) return line;
  // Not one locator fits: the remainder follows the colon.
  return `${head}(+${String(ignored.count)}${
    ignored.atLeast ? " or more" : " more"
  })${tail}`;
}

/** The seven characters a reported scope writes as three code units. */
const SPELLABLE = /[%*?[\]{}]/gu;

/** One raw locator's width as the scope spelling it is reported with. */
function spelledWidth(locator: string): number {
  const folded = oneLine(locator);
  return folded.length + (folded.match(SPELLABLE)?.length ?? 0) * 2;
}

/**
 * Widest the `ignored` line can render for a page that reports these raw
 * locators: at most the five it names, each measured in its scope spelling.
 * The page keeps this width and its newline back before the next passage.
 */
export function grepIgnoredUnits(ignored: {
  readonly count: number;
  readonly locators: ReadonlyArray<string>;
  readonly atLeast: boolean;
}): number {
  const count = ignored.atLeast
    ? `${String(ignored.count)} or more`
    : String(ignored.count);
  const noun = ignored.count === 1 ? "directory" : "directories";
  const head = `[ignored ${count} ${noun}: `;
  const tail = "; a scope that names one searches it]";
  let width = 0;
  let chosen = 0;
  for (const locator of ignored.locators.slice(
    0,
    GREP_LIMITS.ignoredLocators,
  )) {
    const next = chosen + 1;
    const rest = ignored.count - next;
    const candidate =
      head.length +
      width +
      (chosen === 0 ? 0 : 2) +
      spelledWidth(locator) +
      (rest > 0
        ? ` (+${String(rest)}${ignored.atLeast ? " or more" : " more"})`.length
        : 0) +
      tail.length;
    if (candidate > IGNORED_LINE_UNITS) break;
    width += (chosen === 0 ? 0 : 2) + spelledWidth(locator);
    chosen = next;
  }
  if (chosen > 0) return head.length + width + tail.length + 1;
  // Not one locator fits: the remainder follows the colon.
  const remainder = `(+${String(ignored.count)}${
    ignored.atLeast ? " or more" : " more"
  })`;
  return head.length + remainder.length + tail.length + 1;
}

/**
 * Rendered width of the unfinished line with its separating newline, so the
 * file the walk waits on keeps its room back before the page admits a passage.
 */
export function grepUnfinishedUnits(locator: string): number {
  return grepUnfinishedLine(locator).length + 1;
}

/**
 * The model-facing text of a `grep` page: the notice first, each run of
 * passages of one file under its `## <file locator>` line, the warnings line,
 * and the continuation line of a page that is not complete.
 *
 * Two passages of one file merge into one run while their start lines rise;
 * a passage that starts at or before the previous one — an overlapping later
 * scope — opens a new run, so its file line repeats in scope order.
 */
export function renderGrepText(result: UnknownRecord): string {
  const lines: Array<string> = [];
  const { notice } = result;
  if (isNonEmptyString(notice)) lines.push(`notice: ${notice}`);
  let previous: PassageView | undefined;
  for (const passage of passagesOf(result.results)) {
    const continues =
      previous !== undefined &&
      previous.file === passage.file &&
      passage.startLine > previous.startLine;
    if (continues) lines.push("");
    else lines.push(`## ${oneLine(passage.file)}`);
    lines.push(...passageLines(passage));
    previous = passage;
  }
  const warnings = warningsLine(result.warnings);
  if (warnings !== undefined) lines.push(warnings);
  const ignored = ignoredOf(result.ignored);
  if (ignored !== undefined) lines.push(grepIgnoredLine(ignored));
  const { unfinishedFile } = result;
  if (isNonEmptyString(unfinishedFile))
    lines.push(grepUnfinishedLine(unfinishedFile));
  const { complete, cursor } = result;
  if (complete !== true && isNonEmptyString(cursor))
    lines.push(grepContinuationLine(cursor));
  const { truncationNotice } = result;
  if (isNonEmptyString(truncationNotice)) lines.push(`[${truncationNotice}]`);
  return lines.join("\n");
}

/**
 * Width the model receives for a candidate page: its text rendering after the
 * one reserved-name rule, so escaped delimiters count against the page bound
 * (tool-result-rendering "Bounds are measured on the neutralized rendering").
 */
export function measureGrepRendering(result: UnknownRecord): number {
  return neutralizeReservedDelimiters(renderGrepText(result)).length;
}

/**
 * The rendered width one passage adds to a page's text after `previous`: its
 * own lines and the blank line or `## <locator>` line that joins it. The pair
 * is measured as a pair, so one reserved-name token spanning the join counts
 * once, in the width it renders to.
 */
export function grepPassageUnits(
  previous: GrepPassage | undefined,
  passage: GrepPassage,
): number {
  const page = previous === undefined ? [passage] : [previous, passage];
  return (
    measureGrepRendering({ results: page, complete: true }) -
    (previous === undefined
      ? 0
      : measureGrepRendering({ results: [previous], complete: true }))
  );
}
