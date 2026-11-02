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
 * The model-facing text of a `grep` result (tool-result-rendering "A grep page
 * groups consecutive passages under one file line"). Each run of consecutive
 * passages of one file renders under one `## <file locator>` line, passages of
 * one run are separated by one blank line, and a matched line carries the
 * `*N: text` prefix the stored passage already spells as `N: text`.
 */

/** One stored passage, as the page's `results` list carries it. */
interface PassageView {
  /** The file's locator without its line range. */
  readonly file: string;
  /** The one-based start line of the passage. */
  readonly startLine: number;
  readonly content: string;
  readonly matches: ReadonlyArray<number>;
  /** The inline bound cut the passage, and the artifact holds the rest. */
  readonly cut: boolean;
  /** The passage is its file's twentieth: the file holds more after it. */
  readonly truncated: boolean;
}

/** The line a capped twentieth passage ends with: the file holds more, and a
 *  `read` is the only way to see them. */
const CAPPED_PASSAGE_MARKER =
  "[more passages in this file; read it to see them]";

/** The line an inline passage cut at its bound ends with. */
const CUT_PASSAGE_MARKER = "[passage cut; the artifact holds the rest]";

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
 * One passage's lines: the stored `N: text` lines with a `*` before the number
 * of a matched line, then the cut marker of an inline passage and the
 * capped-passage marker of its file's twentieth.
 */
function passageLines(passage: PassageView, markCut: boolean): Array<string> {
  const matched = new Set(passage.matches);
  const stored = passage.content.replace(/\n$/u, "");
  const lines = stored === "" ? [] : stored.split("\n");
  const marked = lines.map((line) => {
    const match = NUMBERED_LINE.exec(line);
    if (match === null) return line;
    return matched.has(Number(match[1])) ? `*${line}` : line;
  });
  if (markCut && passage.cut) marked.push(CUT_PASSAGE_MARKER);
  if (passage.truncated) marked.push(CAPPED_PASSAGE_MARKER);
  return marked;
}

/**
 * Whether two passages of one file share a run: the later one starts after the
 * earlier one. A passage that starts at or before the previous one — an
 * overlapping later scope — opens a new run.
 */
function sharesRun(
  previous: PassageView | undefined,
  passage: PassageView,
): boolean {
  return (
    previous !== undefined &&
    previous.file === passage.file &&
    passage.startLine > previous.startLine
  );
}

/** Whether one stored passage continues the run of the one before it. */
export function grepPassageContinues(
  previous: GrepPassage | undefined,
  passage: GrepPassage,
): boolean {
  const view = passageOf(passage);
  const before = previous === undefined ? undefined : passageOf(previous);
  return view !== undefined && sharesRun(before, view);
}

/**
 * The block one passage adds after `previous`: the blank line that continues
 * a run, or the `## <file locator>` line that opens one, then the passage's own
 * lines. `markCut` renders the inline cut marker, which an artifact never
 * holds: the artifact is the rest the marker names.
 */
function passageBlock(
  previous: PassageView | undefined,
  passage: PassageView,
  markCut: boolean,
): Array<string> {
  const head = sharesRun(previous, passage)
    ? ""
    : `## ${oneLine(passage.file)}`;
  return [head, ...passageLines(passage, markCut)];
}

/**
 * The lines one passage adds to a `grep` text after `previous`. The stored
 * shape is accepted, so a producer can render the same block the result will
 * render before it stores the text.
 */
export function grepPassageBlockLines(
  previous: GrepPassage | undefined,
  passage: GrepPassage,
  markCut = true,
): Array<string> {
  const view = passageOf(passage);
  if (view === undefined) return [];
  const before = previous === undefined ? undefined : passageOf(previous);
  return passageBlock(before, view, markCut);
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

/**
 * Widest the `ignored` line can render for a page that reports these raw
 * locators: at most the five it names, in the spelling the result carries.
 * The page keeps this width and its newline back before the next passage.
 */
export function grepIgnoredUnits(
  ignored: {
    readonly count: number;
    readonly locators: ReadonlyArray<string>;
    readonly atLeast: boolean;
  },
  spell: (locator: string) => string = (locator) => locator,
): number {
  return (
    grepIgnoredLine({
      count: ignored.count,
      locators: ignored.locators
        .slice(0, GREP_LIMITS.ignoredLocators)
        .map(spell),
      atLeast: ignored.atLeast,
    }).length + 1
  );
}

/**
 * Rendered width of the unfinished line with its separating newline, so the
 * file the walk waits on keeps its room back before the page admits a passage.
 */
export function grepUnfinishedUnits(locator: string): number {
  return grepUnfinishedLine(locator).length + 1;
}

/** One stored `remainder` field: the counts and next files after the inline part. */
export interface GrepRemainder {
  readonly files: number;
  readonly passages: number;
  readonly next: ReadonlyArray<{
    readonly locator: string;
    readonly start: number;
    readonly end: number;
  }>;
}

/** The most code units one `[more: …]` line may take. */
export const REMAINDER_LINE_UNITS = 2000;

/** The width the inline part keeps back for the remainder line and its newline. */
export function grepRemainderUnits(): number {
  return REMAINDER_LINE_UNITS + 1;
}

/** The width one `[left out: …; full result not stored]` line takes. */
export function grepLeftOutUnits(count: number, of: string): number {
  return (
    `[left out: ${String(count)} ${of}; full result not stored]`.length + 1
  );
}

/** The stored `remainder` field, or none when it is not one this build wrote. */
function remainderOf(value: unknown): GrepRemainder | undefined {
  if (!isRecord(value)) return undefined;
  const { files, passages, next } = value;
  if (!isNumber(files) || files < 1) return undefined;
  if (!isNumber(passages) || passages < 1) return undefined;
  const entries: Array<GrepRemainder["next"][number]> = [];
  if (Array.isArray(next)) {
    for (const entry of next) {
      if (!isRecord(entry)) return undefined;
      const { locator, start, end } = entry;
      if (!isNonEmptyString(locator)) return undefined;
      if (!isNumber(start) || !isNumber(end) || start < 1 || end < start)
        continue;
      entries.push({ locator, start, end });
    }
  }
  return { files, passages, next: entries };
}

function countNoun(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * One `[more: <files> files, <passages> passages; next: <entries>]` line. Each
 * entry names a file and the artifact range that holds it. An entry that
 * would take the line past 2,000 code units is left out, so the line always
 * renders inside the inline bound the producer kept back for it.
 */
function grepRemainderLine(
  remainder: GrepRemainder,
  artifact: string | undefined,
): string {
  const head = `[more: ${countNoun(remainder.files, "file")}, ${countNoun(
    remainder.passages,
    "passage",
  )}`;
  if (remainder.next.length === 0) return `${head}]`;
  const chosen: Array<string> = [];
  let line: string | undefined;
  for (const entry of remainder.next.slice(0, 10)) {
    const rendered = remainderEntry(entry, artifact);
    const candidate = `${head}; next: ${[...chosen, rendered].join(", ")}]`;
    if (candidate.length > REMAINDER_LINE_UNITS) break;
    chosen.push(rendered);
    line = candidate;
  }
  return line ?? `${head}]`;
}

function remainderEntry(
  entry: GrepRemainder["next"][number],
  artifact: string | undefined,
): string {
  const locator = oneLine(entry.locator);
  if (artifact === undefined) return locator;
  return `${locator} (${artifact}:${String(entry.start)}-${String(entry.end)})`;
}

/** One stored `leftOut` field: what no artifact holds. */
interface LeftOutView {
  readonly count: number;
  readonly of: string;
}

/** The stored `leftOut` field, or none when it is not one this build wrote. */
function leftOutOf(value: unknown): LeftOutView | undefined {
  if (!isRecord(value)) return undefined;
  const { count, of } = value;
  if (!isNumber(count) || count < 1) return undefined;
  if (of !== "lines" && of !== "files" && of !== "results") return undefined;
  return { count, of };
}

/**
 * The passages and the notice line of a `grep` text, before its framing lines.
 * An artifact holds exactly these lines, so an inline line keeps its number.
 */
function passageLinesOf(
  result: UnknownRecord,
  markCut: boolean,
): Array<string> {
  const lines: Array<string> = [];
  const { notice } = result;
  if (isNonEmptyString(notice)) lines.push(`notice: ${notice}`);
  let previous: PassageView | undefined;
  for (const passage of passagesOf(result.results)) {
    lines.push(...passageBlock(previous, passage, markCut));
    previous = passage;
  }
  return lines;
}

/**
 * The lines a `grep` artifact holds: the notice line that starts its inline
 * text, then each passage in result order, inline ones included. The framing
 * lines of the inline text — warnings, ignored directories, an unfinished
 * file, the remainder, and the notice — are not part of the artifact.
 */
export function grepArtifactLines(result: UnknownRecord): Array<string> {
  return passageLinesOf(result, false);
}

/**
 * The model-facing text of a `grep` result: the notice first, each run of
 * passages of one file under its `## <file locator>` line, the warnings line,
 * then the remaining framing lines in their fixed order.
 *
 * Two passages of one file merge into one run while their start lines rise;
 * a passage that starts at or before the previous one — an overlapping later
 * scope — opens a new run, so its file line repeats in scope order.
 */
export function renderGrepText(result: UnknownRecord): string {
  const lines = passageLinesOf(result, true);
  const warnings = warningsLine(result.warnings);
  if (warnings !== undefined) lines.push(warnings);
  const ignored = ignoredOf(result.ignored);
  if (ignored !== undefined) lines.push(grepIgnoredLine(ignored));
  const { unfinishedFile } = result;
  if (isNonEmptyString(unfinishedFile))
    lines.push(grepUnfinishedLine(unfinishedFile));
  const remainder = remainderOf(result.remainder);
  if (remainder !== undefined)
    lines.push(
      grepRemainderLine(
        remainder,
        isNonEmptyString(result.artifact) ? result.artifact : undefined,
      ),
    );
  const { truncationNotice } = result;
  if (isNonEmptyString(truncationNotice)) lines.push(`[${truncationNotice}]`);
  const leftOut = leftOutOf(result.leftOut);
  if (leftOut !== undefined)
    lines.push(
      `[left out: ${String(leftOut.count)} ${leftOut.of}; full result not stored]`,
    );
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
