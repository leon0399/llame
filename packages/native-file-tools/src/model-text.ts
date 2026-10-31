import {
  isNumber,
  isRecord,
  isString,
  neutralizeReservedDelimiters,
  type UnknownRecord,
} from "@workspace/runtime-safety";

/*
 * The model-facing text of a `read`, `edit`, or `write` success
 * (tool-result-rendering "The read header names the source and the shown
 * lines", "The read header carries the source total when it is stored",
 * "Attribution fields render as lines after the header", "Continuation is one
 * bracketed notice line", "Source lines use one prefix grammar", "An edit
 * renders its post-edit region", "A write renders one status line").
 *
 * The stored result already numbers its content lines (`N: text`, or
 * unprefixed for a `raw` read) and stores the ranges it showed, so this module
 * adds only the framing: one header line, the attribution lines the result
 * carries, and the notice lines a bound or the cap adds. It reads a fixed set
 * of fields and ignores every other one — a legacy part without
 * `lineCount`/`entryCount`/`display` renders its legacy form. Every stored
 * value it prints sits on one line: a line break in a path, an attribution
 * value, or the cap notice becomes a space, so no stored value can add an
 * unprefixed line to the framing.
 *
 * The return values are the raw text; the one reserved-name rule is applied by
 * the caller, once, to the whole rendering, and that neutralized text is what
 * the bounds measure. `measureEditRendering` is the mutation bound's measure.
 */

type LineRange = { readonly startLine: number; readonly endLine: number };

/** One attribution line per field the result carries, in this order
 *  (tool-result-rendering "Attribution fields render as lines after the
 *  header"). `adapter` and `notes` have their own forms. */
const ATTRIBUTION_FIELDS: ReadonlyArray<string> = [
  "realPath",
  "finalUrl",
  "method",
  "adapter",
  "notes",
  "knowledgeSpaceName",
  "knowledgeSpaceId",
  "notice",
  "locator",
  "sourceDirectory",
  "resolvedPath",
  "skillDirectory",
  "realSkillDirectory",
  "skillPathInstruction",
];

/** A stored string field, present only when it says something. */
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value !== "";
}

/** A stored framing value as one line. The framing every text shape prints is
 *  positional — the header is the first line, attribution follows it, the
 *  continuation and the cap notice are the last — so a line break inside a
 *  stored value would add an unprefixed line that can imitate any of them.
 *  One run of line breaks becomes one space. */
export function oneLine(value: string): string {
  return value.replaceAll(/[\r\n]+/gu, " ");
}

function asRange(value: unknown): LineRange | undefined {
  if (!isRecord(value)) return undefined;
  const { startLine, endLine } = value;
  return isNumber(startLine) && isNumber(endLine)
    ? { startLine, endLine }
    : undefined;
}

/** The ranges a stored result lists, in order, skipping malformed entries. */
function asRanges(value: unknown): Array<LineRange> {
  if (!Array.isArray(value)) return [];
  const ranges: Array<LineRange> = [];
  for (const entry of value) {
    const range = asRange(entry);
    if (range !== undefined) ranges.push(range);
  }
  return ranges;
}

function formatRange(range: LineRange): string {
  return `${range.startLine}-${range.endLine}`;
}

function adapterLines(value: unknown): Array<string> {
  if (!isRecord(value)) return [];
  const parts: Array<string> = [];
  for (const part of [value.id, value.route, value.origin]) {
    if (isNonEmptyString(part)) parts.push(oneLine(part));
  }
  return parts.length === 0 ? [] : [`adapter: ${parts.join(" ")}`];
}

function noteLines(value: unknown): Array<string> {
  if (!Array.isArray(value)) return [];
  const lines: Array<string> = [];
  for (const entry of value) {
    if (isNonEmptyString(entry)) lines.push(`notes: ${oneLine(entry)}`);
  }
  return lines;
}

/** The attribution lines a result carries, in the spec's order — shared by
 *  every text shape that renders them after its header. */
export function renderAttributionLines(result: UnknownRecord): Array<string> {
  const lines: Array<string> = [];
  for (const field of ATTRIBUTION_FIELDS) {
    const value = result[field];
    if (field === "adapter") lines.push(...adapterLines(value));
    else if (field === "notes") lines.push(...noteLines(value));
    else if (isNonEmptyString(value)) lines.push(`${field}: ${oneLine(value)}`);
  }
  return lines;
}

/** The header of a file read: the shown range in the form of its
 *  representation with the stored total, or the empty and skipped forms a
 *  null shown range produces. A result stored before the ranges were kept
 *  carries content but no range key at all, so it names the locator alone:
 *  `: empty` would deny the content below it. An outline carries no total: its
 *  scan can stop early, so it stores none. */
function fileHeader(result: UnknownRecord): string {
  const path = isNonEmptyString(result.path) ? oneLine(result.path) : "";
  const total =
    result.representation === "outline" || !isNumber(result.lineCount)
      ? ""
      : ` of ${result.lineCount} lines`;
  const ranges = asRanges(result.shownRanges);
  if (ranges.length > 0) {
    const form = result.representation === "raw" ? "raw:" : "";
    return `${path}:${form}${ranges.map(formatRange).join(",")}${total}`;
  }
  const shown = asRange(result.shownRange);
  if (shown !== undefined) {
    const form =
      result.representation === "raw" || result.representation === "outline"
        ? `${result.representation}:`
        : "";
    return `${path}:${form}${formatRange(shown)}${total}`;
  }
  const { nextOffset } = result;
  if (result.truncated === true && isNumber(nextOffset))
    return `${path}: line ${nextOffset} exceeds the result bound and was skipped`;
  if (result.shownRange === null && result.truncated !== true)
    return `${path}: empty`;
  return `${path}${total}`;
}

/** One range selector from `nextOffset`, open-ended once the request is
 *  spent. */
function rangeSelector(
  nextOffset: number,
  endLine: number | undefined,
): string {
  const start = nextOffset + 1;
  return endLine === undefined || nextOffset >= endLine
    ? `${start}-`
    : `${start}-${endLine}`;
}

/**
 * The member a multi-range read stopped inside, then the members after it. A
 * `nextOffset` in the gap before a member, or on its leading context line,
 * resumes from that member: its start is clipped to the resume line, and the
 * members before it are spent.
 */
function multiSelector(ranges: Array<LineRange>, nextOffset: number): string {
  const line = nextOffset + 1;
  const at = ranges.findIndex((range) => line <= range.endLine);
  if (at < 0) return `${line}-`;
  const member = ranges[at];
  if (member === undefined) return `${line}-`;
  const head =
    line >= member.startLine
      ? rangeSelector(nextOffset, member.endLine)
      : formatRange(member);
  return [head, ...ranges.slice(at + 1).map(formatRange)].join(",");
}

/** The read that resumes after this one, in the form the request used. */
function resumeSelector(result: UnknownRecord, nextOffset: number): string {
  if (result.kind === "directory") return `${nextOffset + 1}-`;
  const { lineCount } = result;
  const requested = asRange(result.requestedRange)?.endLine;
  // A requested end at or past the known line count reaches the last line, so
  // the continuation is open-ended, the form the read tool resolves to it.
  const requestedEnd =
    isNumber(lineCount) && requested !== undefined && requested >= lineCount
      ? undefined
      : requested;
  if (result.representation === "outline")
    return `outline:${rangeSelector(nextOffset, requestedEnd)}`;
  const ranges = asRanges(result.requestedRanges);
  const requestedRanges = isNumber(lineCount)
    ? ranges.map((range) => ({
        ...range,
        endLine: Math.min(range.endLine, lineCount),
      }))
    : ranges;
  const selector =
    requestedRanges.length > 0
      ? multiSelector(requestedRanges, nextOffset)
      : rangeSelector(nextOffset, requestedEnd);
  // A raw read stays raw on the way in: a numbered window would drop the
  // verbatim view its `oldText` came from.
  return result.representation === "raw" ? `raw:${selector}` : selector;
}

/** The one bracketed continuation notice a truncated result ends with. A
 *  locator with no room for a selector states the remainder alone, because
 *  the read it would name is one the read tool refuses. */
function continuationLine(result: UnknownRecord): string | undefined {
  if (result.truncated !== true) return undefined;
  const { nextOffset } = result;
  if (!isNumber(nextOffset)) return undefined;
  // Nothing follows the last line: its header already says the line was
  // skipped, and a read past the end would be refused.
  if (
    result.kind !== "directory" &&
    isNumber(result.lineCount) &&
    nextOffset >= result.lineCount
  )
    return undefined;
  let label = "";
  if (result.kind === "directory") {
    const { entryCount } = result;
    if (isNumber(entryCount))
      label = `${entryCount - nextOffset} more entries. `;
  } else if (isNumber(result.lineCount)) {
    label = `${result.lineCount - nextOffset} more lines. `;
  }
  const path = isNonEmptyString(result.path) ? oneLine(result.path) : "";
  // Every colon a web locator's query or fragment opened is URL text, so a
  // trailing selector cannot follow one: `…?version=1:2001-` would request a
  // different URL than the one the source was read from. A host path takes
  // `?` and `#` as ordinary name characters and keeps its selector.
  const webLocatorTakesNoSelector =
    /^https?:\/\//iu.test(path) && /[?#]/u.test(path);
  if (result.kind !== "directory" && webLocatorTakesNoSelector) {
    const stated = isNumber(result.lineCount)
      ? `${result.lineCount - nextOffset} more lines not shown`
      : "more lines not shown";
    return `[${stated}; this locator takes no line selector]`;
  }
  const use = `Use ${path}:${resumeSelector(result, nextOffset)} to continue`;
  return `[${label}${use}]`;
}

/**
 * The model-facing text of a `read` success — a file of any representation or
 * a directory listing. A directory renders its stored content, whose first
 * line is the path, with no second header.
 */
export function renderReadText(result: UnknownRecord): string {
  const content = isNonEmptyString(result.content) ? result.content : "";
  const body = content.replace(/\n$/u, "");
  const bodyLines = body === "" ? [] : [body];
  // A file frames its content with the header and the attribution lines; a
  // directory's stored content already opens with its path, so its
  // attribution follows the listing whose origin it names.
  const lines =
    result.kind === "directory"
      ? [...bodyLines, ...renderAttributionLines(result)]
      : [fileHeader(result), ...renderAttributionLines(result), ...bodyLines];
  const continuation = continuationLine(result);
  if (continuation !== undefined) lines.push(continuation);
  const { truncationNotice } = result;
  if (isNonEmptyString(truncationNotice))
    lines.push(`[${oneLine(truncationNotice)}]`);
  return lines.join("\n");
}

/** The one bracketed marker a mutation rendering ends with when its bound cut
 *  the region. */
const REGION_CUT_MARKER = "[region cut at the bound]";

/** The locator a mutation result identifies itself by, on one line: a POSIX
 *  path may contain a line break, and the header this locator opens is the
 *  rendering's first line. */
function mutationLocator(result: UnknownRecord): string {
  return isNonEmptyString(result.path) ? oneLine(result.path) : "";
}

/** The lines a stored block spans, counted as a source file counts them: a
 *  trailing newline ends the last line instead of starting another. */
function blockLineCount(text: string): number {
  return text.match(/[^\n]*\n|[^\n]+$/gu)?.length ?? 0;
}

/** The display data of a new-shape edit: the three fields a header needs. A
 *  part without all of them keeps the legacy form. */
type EditDisplay = {
  readonly startLine: number;
  readonly oldText: string;
  readonly newText: string;
};

function editDisplay(result: UnknownRecord): EditDisplay | undefined {
  const display = result.display;
  if (!isRecord(display)) return undefined;
  const { startLine, oldText, newText } = display;
  return isNumber(startLine) && isString(oldText) && isString(newText)
    ? { startLine, oldText, newText }
    : undefined;
}

/** The header of a new-shape edit: the first post-edit line, the replaced and
 *  replacement line counts, and the post-edit total when it is stored. */
function editHeader(result: UnknownRecord, display: EditDisplay): string {
  const total = isNumber(result.lineCount)
    ? ` (${result.lineCount} lines total)`
    : "";
  const oldLines = blockLineCount(display.oldText);
  const newLines = blockLineCount(display.newText);
  return `edited ${mutationLocator(result)}: line ${display.startLine}, ${oldLines} -> ${newLines} lines${total}`;
}

/** The header of an edit stored before `display` existed: the region the part
 *  showed, which its stored `diff` never contributes to. */
function legacyEditHeader(result: UnknownRecord): string {
  const shown = asRange(result.shownRange);
  const locator = mutationLocator(result);
  return shown === undefined
    ? `edited ${locator}`
    : `edited ${locator}: region from line ${shown.startLine}`;
}

/**
 * The model-facing text of an `edit` success — the header, the attribution
 * lines, the bounded post-edit region, and the notice lines a cut or the cap
 * adds. The stored `diff`, if a legacy part carries one, is never rendered.
 */
export function renderEditText(result: UnknownRecord): string {
  const display = editDisplay(result);
  const content = isNonEmptyString(result.content) ? result.content : "";
  const body = content.replace(/\n$/u, "");
  const lines = [
    display === undefined
      ? legacyEditHeader(result)
      : editHeader(result, display),
    ...renderAttributionLines(result),
  ];
  if (body !== "") lines.push(body);
  // The marker names the executor's bound, so a cap-only cut must not print it:
  // the cap overwrites `truncated` and adds its own notice. A part stored
  // before `cut` existed has no notice unless the cap cut it.
  const { truncationNotice } = result;
  const capCut = isNonEmptyString(truncationNotice);
  if (result.cut === true || (result.truncated === true && !capCut))
    lines.push(REGION_CUT_MARKER);
  if (capCut) lines.push(`[${oneLine(truncationNotice)}]`);
  return lines.join("\n");
}

/**
 * The model-facing text of a `write` success — one status line and the
 * attribution lines. The written content never reaches a model, even when a
 * legacy part stored it.
 */
export function renderWriteText(result: UnknownRecord): string {
  const action = result.replaced === true ? "replaced" : "created";
  const total = isNumber(result.lineCount)
    ? ` (${result.lineCount} lines)`
    : "";
  return [
    `${action} ${mutationLocator(result)}${total}`,
    ...renderAttributionLines(result),
  ].join("\n");
}

/**
 * Width the model receives for an edit candidate: its text rendering after the
 * one reserved-name rule, so escaped delimiters count against the mutation
 * bound (tool-result-rendering "Bounds are measured on the neutralized
 * rendering").
 */
export function measureEditRendering(result: UnknownRecord): number {
  return neutralizeReservedDelimiters(renderEditText(result)).length;
}
