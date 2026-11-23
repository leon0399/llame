import { constants } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

/** `O_NOFOLLOW` makes the kernel refuse a symbolic link at the target, so a
 *  resolver's `lstat` checks cannot be raced by a link swapped in after. */
export function openFlags(followSymlinks: boolean): number {
  const base = constants.O_RDONLY | constants.O_NONBLOCK;

  return followSymlinks ? base : base | constants.O_NOFOLLOW;
}

export function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

export class NativeFileError extends Error {
  /** `message` defaults to the type, which is what a caller that only
   *  branches on `type` sees; a caller with wording of its own supplies it. */
  constructor(
    readonly type:
      | "invalid_path"
      | "invalid_selector"
      | "not_found"
      | "not_regular_file"
      | "invalid_utf8"
      | "invalid_input"
      | "file_exists"
      | "old_text_not_found"
      | "old_text_ambiguous"
      | "outcome_unknown"
      | "executor_unavailable"
      | "directory_too_large"
      | "representation_too_large"
      | "media_too_large"
      | "unsupported_media_type",
    message?: string,
  ) {
    super(message ?? type);
  }
}

/**
 * The working forms, named once for every source that refuses a selector
 * outside them. A model that wrote a nearly correct selector learns one
 * grammar here rather than a different one per source.
 */
const SELECTOR_FORMS =
  "A line selector is :L5, :L5-10, :L5+10, :L5-, or :-L5, or a comma-separated list of them. A bare number also reads as a line. :raw is the whole file, or :raw: followed by a list of them, and :outline takes one of them after the colon. A line number starts at 1.";

/**
 * The one message for a suffix outside the grammar. Sources whose locator has
 * an encoded spelling for a literal colon pass the sentence naming it; the
 * host has none (`%3A` decodes to `:` there) and names the forms alone.
 */
export function invalidSelectorMessage(encodedSpelling?: string): string {
  return encodedSpelling === undefined
    ? SELECTOR_FORMS
    : `${SELECTOR_FORMS} ${encodedSpelling}`;
}

/** One absolute member interval, zero-based, `limit` lines long. */
type Interval = { offset: number; limit: number };

/** The window a placed request reads, once its members are absolute. */
export type PlacedWindow = Pick<
  ReadTarget,
  "offset" | "limit" | "ranges" | "expandedRanges"
>;

/**
 * The readers' invariant: a target reaching any of them carries absolute
 * members only. A target whose end-relative members are still pending would
 * be read from line 1 under a `requestedRange` the request never asked for,
 * so a source that has not placed them is refused instead. The source layer
 * resolves against the count it holds before calling.
 */
export function assertResolvedTarget(target: ReadTarget): void {
  if (target.pending !== undefined)
    throw new NativeFileError("invalid_selector");
}

export type ReadTarget = {
  path: string;
  /** Canonical host path when it differs from `path` as given, which is how a
   *  model without shell access learns where a read through a link landed.
   *  Host paths only: a scheme resolver never sets it. */
  realPath?: string;
  offset: number;
  limit?: number;
  raw: boolean;
  /** Markdown outline representation request. */
  outline?: boolean;
  directory?: boolean;
  /** Room withheld from the shared result cap for a caller's envelope. */
  reserveCodeUnits?: number;
  /** The source's line count once the reader knows it: a file's byte scan, or
   *  the line count of text already in hand. The result constructors copy it,
   *  so the header's total and the continuation's label are measured with
   *  it. Absent for an outline and for a file past the count bound. */
  lineCount?: number;
  /** Listing only: whether a link entry may name its target. Absent means the
   *  listing default, which is to name it. */
  linkTargets?: boolean;
  /**
   * Comma request: merged requested intervals, zero-based. Absent for
   * single-range reads, whose `offset`/`limit` window is unchanged.
   */
  ranges?: Array<{ offset: number; limit: number }>;
  /**
   * Comma request: read intervals after one-line context growth and
   * re-merge. Absent for single-range reads.
   */
  expandedRanges?: Array<{ offset: number; limit: number }>;

  /**
   * The member list, in its bare spelling, when any of its members needs the
   * source's count before the window can be placed. While it is set, `offset`,
   * `limit`, `ranges`, and `expandedRanges` describe no read; the resolution
   * step parses it against the count and fills them in. The applier already
   * validated every member, so that step only places them.
   */
  pending?: string;
};

/**
 * A `scheme://` prefix names the authority that resolves the rest of the
 * path. This package implements only the host authority, so it recognizes
 * the prefix solely to refuse it before any selector split or filesystem
 * probe; callers that implement a scheme resolve it before calling here.
 */
const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//u;

export function parsePathScheme(
  input: string,
): { scheme: string; rest: string } | undefined {
  const match = SCHEME_PREFIX.exec(input);

  if (!match) return undefined;

  return {
    scheme: match[1].toLowerCase(),
    rest: input.slice(match[0].length),
  };
}

/** Input members stay bounded so metadata and normalization work do too. */
const MAX_SELECTOR_RANGES = 64;

function mergeIntervals(intervals: Array<Interval>): Array<Interval> {
  const sorted = [...intervals].sort((a, b) => a.offset - b.offset);
  const merged: Array<Interval> = [];

  for (const current of sorted) {
    const last = merged.at(-1);

    if (last !== undefined && current.offset <= last.offset + last.limit) {
      last.limit =
        Math.max(last.offset + last.limit, current.offset + current.limit) -
        last.offset;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/** Every bound is a one-based positive safe integer, in every member form. */
function bound(text: string): number {
  const value = Number(text);

  if (!Number.isSafeInteger(value) || value < 1)
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());

  return value;
}

/**
 * One member of a range selector. A bare `N` is the single line N, the form a
 * caller writes when it wants one line and the form a result's own line
 * prefixes teach it to write.
 */
function parseRange(value: string): Interval {
  const match = /^(\d+)(?:([-+])(\d+))?$/u.exec(value);

  if (!match)
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());
  const start = bound(match[1]);
  const operand = match[3] === undefined ? start : bound(match[3]);
  const end = match[2] === "+" ? start + (operand - 1) : operand;

  if (!Number.isSafeInteger(end) || end < start)
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());

  return { offset: start - 1, limit: end - start + 1 };
}

const THROUGH_END = /^(\d+)-$/u;
const LAST_LINES = /^-(\d+)$/u;

/**
 * One member in any of its five forms, placed against the source's count:
 * `N-` runs to the last line and `-K` takes the last K, clipping at line 1
 * the way `tail` does, and a member past the last line is empty. A count of
 * zero therefore validates a member's bounds without placing anything,
 * which is how the applier checks every member it is given.
 */
function parseMember(value: string, count: number): Interval {
  const throughEnd = THROUGH_END.exec(value);

  if (throughEnd) {
    const start = bound(throughEnd[1]);

    return { offset: start - 1, limit: Math.max(0, count - start + 1) };
  }

  const lastLines = LAST_LINES.exec(value);

  if (lastLines) {
    const start = Math.max(1, count - bound(lastLines[1]) + 1);

    return { offset: start - 1, limit: count - start + 1 };
  }

  return parseRange(value);
}

/**
 * Split a comma selector. The shape gate already enforced each member's
 * form, so the parsing that follows only repeats the numeric checks.
 */
function splitMembers(value: string): Array<string> {
  const members = value.split(",");

  if (members.length > MAX_SELECTOR_RANGES)
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());

  return members;
}

/**
 * The window a placed request reads: one range, or the merged request with
 * the one-line context growth every shipped reader already expects.
 */
function placeMembers(
  members: Array<Interval>,
  comma: boolean,
  raw: boolean,
): PlacedWindow {
  const ranges = mergeIntervals(members);

  if (!comma) return ranges[0];

  return {
    offset: ranges[0].offset,
    ranges,
    expandedRanges: raw
      ? ranges.map((range) => ({ ...range }))
      : expandRanges(ranges),
  };
}

/**
 * A pending member list placed against the source's count. A member past the
 * last line is dropped here, before merge and context growth, so it emits
 * nothing and adds no context line; when it is the first requested start it
 * keeps the shipped start-past-EOF window, which the reader already refuses,
 * and a comma request keeps its plural fields so that refusal reads as the
 * empty multi-range result it is.
 */
export function resolvePendingSelector(
  pending: string,
  count: number,
  raw = false,
): PlacedWindow {
  const comma = pending.includes(",");
  const placed = pending.split(",").map((member) => parseMember(member, count));
  const first = Math.min(...placed.map((member) => member.offset));

  if (placed.some((member) => member.limit === 0 && member.offset === first))
    return comma
      ? { offset: first, ranges: [], expandedRanges: [] }
      : { offset: first };

  return placeMembers(
    placed.filter((member) => member.limit > 0),
    comma,
    raw,
  );
}

/**
 * The one resolution step: place a target's end-relative members against the
 * source's count and hand every reader the ordinary absolute target. A target
 * with nothing pending comes back unchanged, so a source that already knows
 * its count can call this unconditionally.
 */
export function resolveEndRelativeSelector(
  target: ReadTarget,
  count: number,
): ReadTarget {
  if (target.pending === undefined) return target;
  const { pending, ...resolved } = target;

  return {
    ...resolved,
    ...resolvePendingSelector(pending, count, target.raw),
  };
}

/**
 * Grow each merged interval one line per side and re-merge windows that now
 * overlap or sit adjacent. The trailing growth always applies; the reader
 * clips it at EOF. The leading growth clips at the first line here.
 */
function expandRanges(ranges: Array<Interval>): Array<Interval> {
  return mergeIntervals(
    ranges.map((range) => ({
      offset: Math.max(0, range.offset - 1),
      limit: range.limit + (range.offset > 0 ? 1 : 0) + 1,
    })),
  );
}

async function isDirectoryTarget(path: string): Promise<boolean> {
  const lstats = await lstat(path);

  if (lstats.isDirectory()) return true;

  if (lstats.isSymbolicLink()) {
    const target = await stat(path);

    return target.isDirectory();
  }

  return false;
}

/**
 * The `realPath` a host file read reports: the canonical path, but only when
 * it differs from the normalized path as given, so a `..` segment that merely
 * spells the same location is not a link. A path that cannot be resolved —
 * missing, dangling, or denied — omits the field instead of failing the read.
 */
async function realPathField(path: string): Promise<{ realPath?: string }> {
  try {
    const canonical = await realpath(path);

    return canonical === normalize(path) ? {} : { realPath: canonical };
  } catch {
    return {};
  }
}

/** The literal-path probe's answer: the target the whole text names, or the
 *  filesystem error that leaves the text to selector parsing. */
type HostProbe =
  | { readonly kind: "target"; readonly target: ReadTarget }
  | { readonly kind: "missing"; readonly error: NodeJS.ErrnoException };

/**
 * Probe the whole input as one literal path. A missing or overlong name is the
 * caller's cue that the text may carry a read selector instead.
 */
async function probeHostPath(input: string): Promise<HostProbe> {
  if (parsePathScheme(input) || !isAbsolute(input) || input.includes("\0"))
    throw new NativeFileError("invalid_path");

  const hasTrailingSep = input.length > 1 && input.endsWith("/");
  const cleanPath = hasTrailingSep ? input.slice(0, -1) : input;

  try {
    if (await isDirectoryTarget(cleanPath)) {
      return {
        kind: "target",
        target: { path: cleanPath, offset: 0, raw: false, directory: true },
      };
    }

    if (hasTrailingSep) throw new NativeFileError("not_found");

    return {
      kind: "target",
      target: {
        path: cleanPath,
        offset: 0,
        raw: false,
        ...(await realPathField(cleanPath)),
      },
    };
  } catch (error) {
    if (error instanceof NativeFileError) throw error;

    if (!isNodeError(error)) throw error;
    const code = error.code;

    if (code === "ENOTDIR") throw new NativeFileError("not_found");

    // An overlong name cannot exist as a literal path, so it falls through
    // to selector parsing instead of surfacing a filesystem error.
    if (code !== "ENOENT" && code !== "ENAMETOOLONG") throw error;

    return { kind: "missing", error };
  }
}

export async function resolveReadTarget(input: string): Promise<ReadTarget> {
  const probe = await probeHostPath(input);

  if (probe.kind === "target") return probe.target;

  if (input.length > 1 && input.endsWith("/"))
    throw new NativeFileError("not_found");

  const parsed = parseSelector(input);

  return classifyParsedTarget(parsed);
}

/** One bare line member: `N`, `N-M`, `N+K`, `N-`, or `-K`. */
const BARE_MEMBER_SOURCE = String.raw`\d+(?:[+-]\d+|-)?|-\d+`;

/** The unit letters, in either case: `L` names lines, and `P` and `M` are
 *  reserved for units no source reads yet. Any other letter is no shape, so
 *  `notes:X5` stays part of the path on a source that keeps unknown suffixes. */
const LINE_UNIT = "[Ll]";
const RESERVED_UNIT = "[PpMm]";

/**
 * One member carrying a unit letter: `L5`, `L5-10`, `L5-L10`, `L5+10`, `L5-`,
 * and `-L5`. A second number carries the letter only when the first does, and
 * no letter follows `+`, so `5-L10` and `L5+L10` stay outside the grammar.
 */
function unitMemberSource(unit: string): string {
  return `${unit}\\d+(?:-(?:${unit})?\\d+|\\+\\d+|-)?|-${unit}\\d+`;
}

/** A unit letter before the minus sign, e.g. `L-5`: both readings exist, so
 *  the applier refuses it with the fixed hint instead of choosing one. */
function misplacedMemberSource(unit: string): string {
  return `${unit}-\\d+`;
}

/** The members a read places: a bare one, or the same form with `L`. */
const LINE_MEMBER_SOURCE = `(?:${BARE_MEMBER_SOURCE}|${unitMemberSource(LINE_UNIT)})`;

/**
 * Every member the gate admits, the refused ones included. A `P` or `M`
 * member and a misplaced letter are selector shapes so that a split without a
 * literal probe claims them as a selector, and the applier rather than the
 * path refuses them.
 */
const MEMBER_SOURCE = `(?:${LINE_MEMBER_SOURCE}|${unitMemberSource(RESERVED_UNIT)}|${misplacedMemberSource(LINE_UNIT)}|${misplacedMemberSource(RESERVED_UNIT)})`;
const MEMBER_LIST_SOURCE = `${MEMBER_SOURCE}(?:,${MEMBER_SOURCE})*`;

/**
 * The whole selector grammar, in one place: the one member set in bare lists,
 * `raw:` lists, and the outline's single member, both spellings of a raw read,
 * and the line and column form. A caller that must distinguish a malformed
 * selector from a colon that was never a selector at all tests the shape
 * first; everything else applies it and lets the applier refuse the shapes
 * this gate admits for the sake of a split, and the member parsing reject the
 * bounds it admits.
 */
const SELECTOR_SUFFIX = new RegExp(
  `^(?:raw(?::${MEMBER_LIST_SOURCE})?|outline(?::${MEMBER_SOURCE})?|${MEMBER_LIST_SOURCE}:raw|${MEMBER_LIST_SOURCE}|(?:raw:|outline:)?\\d+:\\d+)$`,
  "u",
);

/** A `<list>:raw` split claims the segment before `:raw` only in this shape. */
const MEMBER_LIST = new RegExp(`^${MEMBER_LIST_SOURCE}$`, "u");

/** A suffix of two bare whole numbers: a line and the column after it. */
const LINE_AND_COLUMN = /^(\d+):\d+$/u;

/** A misplaced line unit alone, e.g. `L-5`: the one refused member with its
 *  own hint. Built from the unit constants, so a new reserved unit is refused
 *  by the shared sentence rather than reaching the member parsing. */
const MISPLACED_LINE_MEMBER = new RegExp(
  `^${misplacedMemberSource(LINE_UNIT)}$`,
  "u",
);

/** Any member that names a reserved unit, at its start or after a minus. */
const RESERVED_MEMBER = new RegExp(`^-?${RESERVED_UNIT}`, "u");

export function isSelectorSuffix(value: string): boolean {
  return SELECTOR_SUFFIX.test(value);
}

/** `L<start>-<end>` — the canonical printed line range. */
export function formatLineRange(start: number, end: number): string {
  return `L${start}-${end}`;
}

/**
 * The unit letter is accepted on input only: a member reaches the digit-only
 * placement, the `pending` field, and the canonical spelling as `N`, `N-M`,
 * `N+K`, `N-`, or `-K`. The separator before the letter is captured so the
 * replacement keeps it.
 */
const UNIT_LETTER = /(^|[-,])[Ll](?=\d)/gu;

/**
 * A selector's representation and its member list, read once for every step
 * that needs them: the canonical spelling, the refusal, and the applier.
 */
type SelectorParts = {
  readonly representation?: "raw" | "outline";
  readonly list: string;
};

function selectorParts(selector: string): SelectorParts {
  if (selector.startsWith("raw:"))
    return { representation: "raw", list: selector.slice(4) };

  if (selector.startsWith("outline:"))
    return { representation: "outline", list: selector.slice(8) };

  if (selector.endsWith(":raw"))
    return { representation: "raw", list: selector.slice(0, -4) };

  return { list: selector };
}

/**
 * The canonical spelling of a selector a read accepts: every line member
 * carries an upper-case `L`, a representation keeps its prefix, and a line and
 * column drops the column. `undefined` means a refused shape, something
 * outside the grammar, or a member whose bounds no read places, so a caller
 * prints only what reads back.
 */
export function canonicalSelector(selector: string): string | undefined {
  if (selector === "raw" || selector === "outline") return selector;

  if (!isSelectorSuffix(selector)) return undefined;

  const lineAndColumn = LINE_AND_COLUMN.exec(selector);

  if (lineAndColumn !== null) return canonicalMembers(lineAndColumn[1]);

  const { representation, list } = selectorParts(selector);

  if (selectorRefusal(representation, list) !== undefined) return undefined;

  return canonicalMembers(list, representation);
}

/** The canonical spelling of one member list, under its representation. */
function canonicalMembers(
  value: string,
  representation?: "raw" | "outline",
): string | undefined {
  const members = readableMembers(value);

  if (members === undefined) return undefined;

  const canonical = members
    .map((member) =>
      member.startsWith("-") ? `-L${member.slice(1)}` : `L${member}`,
    )
    .join(",");

  return representation === undefined
    ? canonical
    : `${representation}:${canonical}`;
}

/**
 * The members of a list in their bare spelling, when a read places every one:
 * the count, the forms, and the bounds all pass. `undefined` otherwise, so a
 * canonical spelling is printed only for a selector that reads back.
 */
function readableMembers(value: string): Array<string> | undefined {
  try {
    const members = splitMembers(value.replaceAll(UNIT_LETTER, "$1"));

    for (const member of members) parseMember(member, 0);

    return members;
  } catch {
    return undefined;
  }
}

/**
 * The refusal a shape the gate admits still earns: a reserved `P` or `M`
 * member, a misplaced unit letter, or a line and column after a
 * representation. The first refused member in list order decides the message,
 * so one list names one rule.
 */
function selectorRefusal(
  representation: "raw" | "outline" | undefined,
  list: string,
): string | undefined {
  if (representation !== undefined && LINE_AND_COLUMN.test(list))
    return invalidSelectorMessage();

  for (const member of list.split(",")) {
    // A misplaced letter has two readings, so the hint names both rather than
    // choosing one; the number is the member's own, as written.
    if (MISPLACED_LINE_MEMBER.test(member)) {
      const count = member.slice(2);

      return `Write -L${count} for the last ${count} lines, or L1-${count} for the first ${count}.`;
    }

    if (RESERVED_MEMBER.test(member)) return invalidSelectorMessage();
  }

  return undefined;
}

/** Apply an already-split selector suffix to a path used verbatim. */
export function applySelectorSuffix(
  path: string,
  selector: string | undefined,
): ReadTarget {
  if (selector === undefined) return { path, offset: 0, raw: false };

  if (selector === "raw") return { path, offset: 0, raw: true };

  if (selector === "outline")
    return { path, offset: 0, raw: false, outline: true };

  if (!isSelectorSuffix(selector))
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());
  const lineAndColumn = LINE_AND_COLUMN.exec(selector);

  if (lineAndColumn !== null)
    return applyMembers(path, lineAndColumn[1], false);
  const { representation, list } = selectorParts(selector);
  const refusal = selectorRefusal(representation, list);

  if (refusal !== undefined)
    throw new NativeFileError("invalid_selector", refusal);
  const target = applyMembers(path, list, representation === "raw");

  return representation === "outline" ? { ...target, outline: true } : target;
}

/**
 * Apply validated members to a path. A single member is one window; a comma
 * request keeps its merged request for `requestedRanges` and reads the
 * context-grown intervals, with `offset` the first requested start for the
 * shared EOF rule. A member only a source's count can place leaves the whole
 * list pending, in its bare spelling, for the resolution step.
 */
function applyMembers(path: string, value: string, raw: boolean): ReadTarget {
  const bare = value.replaceAll(UNIT_LETTER, "$1");
  const members = splitMembers(bare);
  // A count of zero validates every member's bounds and places an
  // end-relative one to nothing, so a member the count must place is exactly
  // the one that comes back empty.
  const intervals = members.map((member) => parseMember(member, 0));

  if (intervals.some((member) => member.limit === 0))
    return { path, offset: 0, raw, pending: bare };

  return {
    path,
    raw,
    ...placeMembers(intervals, members.length > 1, raw),
  };
}

/** A native path split into its locator and optional read selector. */
export interface SelectorSplit {
  readonly path: string;
  readonly selector?: string;
}

/**
 * The trailing `:raw` claim: the marker, its representation operand, or a
 * `:N:M` tail the applier refuses. Each splitter that keeps unknown suffixes
 * as part of a path shares these three patterns and gates them on its own
 * rule for where a selector may open.
 */
export const RAW_SUFFIX = /:raw(?::(\d+:\d+|[^:/]*))?$/u;

export const OUTLINE_SUFFIX = /:outline(?::(\d+:\d+|[^:/]*))?$/u;

/** A trailing `:N:M` pair, claimed before the last-colon fallback. */
export const LINE_COLUMN_SUFFIX = /:\d+:\d+$/u;

/**
 * Split the `path:selector` suffix off `input`: the `:raw` and `:outline`
 * forms claim everything after their marker, a line and column splits before
 * the last-colon fallback, and everything else is a path with no selector. A
 * trailing `:raw` takes the colon segment before it as the range list when
 * that segment has the member-list shape; any other segment stays on the path,
 * so `notes:draft:raw` is still the raw read of `notes:draft`. Each trailing
 * representation also claims a `:N:M` tail, which the applier then refuses, so
 * `x.ts:raw:12:5` is not line 12 of `x.ts:raw`. The suffix is returned as
 * written — a caller that probes `${path}:${selector}` must test the text the
 * model wrote — and unvalidated: a caller that acts on it applies the shared
 * grammar, which rejects what the shape gate admits but the read does not.
 */
export function splitSelectorSuffix(input: string): SelectorSplit {
  const raw = RAW_SUFFIX.exec(input);

  if (raw) {
    const before = input.slice(0, raw.index);

    if (raw[1] !== undefined)
      return { path: before, selector: `raw:${raw[1]}` };

    return rawSplit(before);
  }

  const outline = OUTLINE_SUFFIX.exec(input);

  if (outline) {
    return {
      path: input.slice(0, outline.index),
      selector: input.slice(outline.index + 1),
    };
  }

  const lineAndColumn = LINE_COLUMN_SUFFIX.exec(input);

  if (lineAndColumn !== null && lineAndColumn.index > input.lastIndexOf("/"))
    return {
      path: input.slice(0, lineAndColumn.index),
      selector: input.slice(lineAndColumn.index + 1),
    };

  const colon = input.lastIndexOf(":");

  return colon > input.lastIndexOf("/")
    ? { path: input.slice(0, colon), selector: input.slice(colon + 1) }
    : { path: input };
}

/**
 * The `<list>:raw` spelling: the segment before a trailing `:raw` is the range
 * list only when it has the member-list shape, so a path segment that merely
 * ends in digits keeps its colon and stays the raw read of that path. The
 * suffix comes back as written, so `notes.md:L4-5:raw` names `L4-5:raw` rather
 * than a spelling the model never typed.
 */
function rawSplit(before: string): SelectorSplit {
  const colon = before.lastIndexOf(":");

  if (colon <= before.lastIndexOf("/"))
    return { path: before, selector: "raw" };
  const list = before.slice(colon + 1);

  return MEMBER_LIST.test(list)
    ? { path: before.slice(0, colon), selector: `${list}:raw` }
    : { path: before, selector: "raw" };
}

/** Split a combined `path:selector` string, then apply the shared grammar. */
function parseSelector(input: string): ReadTarget {
  const { path, selector } = splitSelectorSuffix(input);

  return applySelectorSuffix(path, selector);
}

async function classifyParsedTarget(target: ReadTarget): Promise<ReadTarget> {
  try {
    if (await isDirectoryTarget(target.path)) {
      return { ...target, directory: true };
    }
  } catch {
    // Let downstream handle missing paths.
  }

  return { ...target, ...(await realPathField(target.path)) };
}
