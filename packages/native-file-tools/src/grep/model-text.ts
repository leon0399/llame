import {
  isNumber,
  isRecord,
  isString,
  neutralizeReservedDelimiters,
  type UnknownRecord,
} from "@workspace/runtime-safety";

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
  readonly locator: string;
  /** The one-based start line, and the file's locator without its range. */
  readonly file: string;
  readonly startLine: number;
  readonly content: string;
  readonly matches: ReadonlyArray<number>;
  readonly truncated: boolean;
}

/** The line a capped twentieth passage ends with: the file holds more, and a
 *  `read` is the only way to see them. */
const CAPPED_PASSAGE_MARKER =
  "[more passages in this file; read it to see them]";

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

/** The one-based start line of a passage locator, or 0 when it is malformed. */
function passageStartLine(locator: string): number {
  const separator = locator.lastIndexOf(":");
  const match =
    separator === -1 ? null : RANGE_SUFFIX.exec(locator.slice(separator + 1));
  return match === null ? 0 : Number(match[1]);
}

/** One stored passage, or none when the result entry is not a passage. */
function passageOf(value: unknown): PassageView | undefined {
  if (!isRecord(value)) return undefined;
  const { locator, content, matches, truncated } = value;
  if (!isString(locator) || locator === "" || !isString(content))
    return undefined;
  return {
    locator,
    file: grepFileLocator(locator),
    startLine: passageStartLine(locator),
    content,
    matches: Array.isArray(matches)
      ? matches.filter((line): line is number => isNumber(line))
      : [],
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
 * number of a matched line, then the capped-passage marker when the file holds
 * more passages.
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
    if (!isString(kind) || kind === "" || !isNumber(count) || count < 1)
      continue;
    warnings.push(`${String(count)} ${kind}`);
  }
  return warnings.length === 0
    ? undefined
    : `[warnings: ${warnings.join(", ")}]`;
}

/** The one bracketed line that carries the cursor of a continuing page. */
export function grepContinuationLine(cursor: string): string {
  return `[more results. Continue with cursor: ${cursor}]`;
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
  if (isString(notice) && notice !== "") lines.push(`notice: ${notice}`);
  let previous: PassageView | undefined;
  for (const passage of passagesOf(result.results)) {
    const continues =
      previous !== undefined &&
      previous.file === passage.file &&
      passage.startLine > previous.startLine;
    if (continues) lines.push("");
    else lines.push(`## ${passage.file}`);
    lines.push(...passageLines(passage));
    previous = passage;
  }
  const warnings = warningsLine(result.warnings);
  if (warnings !== undefined) lines.push(warnings);
  const { complete, cursor } = result;
  if (complete !== true && isString(cursor) && cursor !== "")
    lines.push(grepContinuationLine(cursor));
  const { truncationNotice } = result;
  if (isString(truncationNotice) && truncationNotice !== "")
    lines.push(`[${truncationNotice}]`);
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
