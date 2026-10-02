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
      | "representation_too_large",
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
  "A line selector is :N, :N-M, :N+K, :N-, or :-K, or a comma-separated list of them; :raw is the whole file, or :raw: followed by a list of them; and :outline takes one of them after the colon. A line number starts at 1.";

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

/**
 * A member only the source's count can place: `N-` is line N through the
 * source's last line, `-K` is its last K lines.
 */
export type EndRelativeMember =
  | { readonly kind: "through-end"; readonly fromLine: number }
  | { readonly kind: "last-lines"; readonly lastLines: number };

/**
 * A selector whose members are not all placeable yet: the absolute members
 * beside the end-relative ones, and whether the request was a comma list,
 * which reports plural range fields even when resolution leaves one interval.
 */
export type PendingSelector = {
  readonly comma: boolean;
  readonly members: ReadonlyArray<Interval | EndRelativeMember>;
};

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
   * Members that need the source's count before any of them can be read. While
   * it is set, `offset`, `limit`, `ranges`, and `expandedRanges` describe no
   * read; the resolution step fills them in.
   */
  pending?: PendingSelector;
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

function isEndRelative(
  member: Interval | EndRelativeMember,
): member is EndRelativeMember {
  return "kind" in member;
}

/**
 * One member in any of its five forms. `N-` and `-K` name the end of the
 * source, so they come back unresolved for the resolution step.
 */
function parseMember(value: string): Interval | EndRelativeMember {
  const throughEnd = THROUGH_END.exec(value);
  if (throughEnd)
    return { kind: "through-end", fromLine: bound(throughEnd[1]) };
  const lastLines = LAST_LINES.exec(value);
  if (lastLines) return { kind: "last-lines", lastLines: bound(lastLines[1]) };
  return parseRange(value);
}

/**
 * Split a comma selector and validate every member with the single-range
 * bounds. The shape gate already enforced each member's form, so the parsing
 * here only repeats the numeric checks. End-relative members come back apart
 * from the absolute ones because only a source count can place them.
 */
function parseMembers(value: string) {
  const members = value.split(",");
  if (members.length > MAX_SELECTOR_RANGES)
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());
  const intervals: Array<Interval> = [];
  const endRelative: Array<EndRelativeMember> = [];
  for (const member of members) {
    const parsed = parseMember(member);
    if (isEndRelative(parsed)) endRelative.push(parsed);
    else intervals.push(parsed);
  }
  return { comma: members.length > 1, intervals, endRelative };
}

/**
 * One member placed against the source's count: `N-` runs to the last line and
 * `-K` takes the last K, clipping at line 1 the way `tail` does. A member past
 * the last line is empty.
 */
function placeMember(
  member: Interval | EndRelativeMember,
  count: number,
): Interval {
  if (!isEndRelative(member)) return member;
  const start =
    member.kind === "through-end"
      ? member.fromLine
      : Math.max(1, count - member.lastLines + 1);
  return { offset: start - 1, limit: Math.max(0, count - start + 1) };
}

/**
 * The window a placed request reads: one range, or the merged request with
 * the one-line context growth every shipped reader already expects.
 */
function placeMembers(
  members: Array<Interval>,
  comma: boolean,
  raw: boolean,
): Pick<ReadTarget, "offset" | "limit" | "ranges" | "expandedRanges"> {
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
 * A pending request placed against the source's count. A member past the last
 * line is dropped here, before merge and context growth, so it emits nothing
 * and adds no context line; when it is the first requested start it keeps the
 * shipped start-past-EOF window, which the reader already refuses.
 */
function placePendingSelector(
  pending: PendingSelector,
  count: number,
  raw: boolean,
): Pick<ReadTarget, "offset" | "limit" | "ranges" | "expandedRanges"> {
  const placed = pending.members.map((member) => placeMember(member, count));
  const first = Math.min(...placed.map((member) => member.offset));
  if (placed.some((member) => member.limit === 0 && member.offset === first))
    return { offset: first };
  return placeMembers(
    placed.filter((member) => member.limit > 0),
    pending.comma,
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
  return { ...resolved, ...placePendingSelector(pending, count, target.raw) };
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

export async function resolveReadTarget(input: string): Promise<ReadTarget> {
  if (parsePathScheme(input) || !isAbsolute(input) || input.includes("\0"))
    throw new NativeFileError("invalid_path");

  const hasTrailingSep = input.length > 1 && input.endsWith("/");
  const cleanPath = hasTrailingSep ? input.slice(0, -1) : input;

  try {
    if (await isDirectoryTarget(cleanPath)) {
      return { path: cleanPath, offset: 0, raw: false, directory: true };
    }
    if (hasTrailingSep) throw new NativeFileError("not_found");
    return {
      path: cleanPath,
      offset: 0,
      raw: false,
      ...(await realPathField(cleanPath)),
    };
  } catch (error) {
    if (error instanceof NativeFileError) throw error;
    if (!isNodeError(error)) throw error;
    const code = error.code;
    if (code === "ENOTDIR") throw new NativeFileError("not_found");
    // An overlong name cannot exist as a literal path, so it falls through
    // to selector parsing instead of surfacing a filesystem error.
    if (code !== "ENOENT" && code !== "ENAMETOOLONG") throw error;
  }
  if (hasTrailingSep) throw new NativeFileError("not_found");

  const parsed = parseSelector(input);
  return classifyParsedTarget(parsed);
}

/** One member: `N`, `N-M`, `N+K`, `N-`, or `-K`. */
const MEMBER_SOURCE = String.raw`\d+(?:[+-]\d+|-)?|-\d+`;
const MEMBER = `(?:${MEMBER_SOURCE})`;
const MEMBER_LIST_SOURCE = `${MEMBER}(?:,${MEMBER})*`;

/**
 * The whole selector grammar, in one place: the one member set in bare lists,
 * `raw:` lists, and the outline's single member, plus both spellings of a raw
 * read. A caller that must distinguish a malformed selector from a colon that
 * was never a selector at all tests the shape first; everything else applies
 * it and lets the member parsing reject the bounds this shape admits.
 */
const SELECTOR_SUFFIX = new RegExp(
  `^(?:raw(?::${MEMBER_LIST_SOURCE})?|outline(?::${MEMBER})?|${MEMBER_LIST_SOURCE}:raw|${MEMBER_LIST_SOURCE})$`,
  "u",
);
/** A `<list>:raw` split claims the segment before `:raw` only in this shape. */
const MEMBER_LIST = new RegExp(`^${MEMBER_LIST_SOURCE}$`, "u");

export function isSelectorSuffix(value: string): boolean {
  return SELECTOR_SUFFIX.test(value);
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
  const trailingRaw = /^(.*):raw$/u.exec(selector);
  if (trailingRaw !== null && MEMBER_LIST.test(trailingRaw[1]))
    return applyMembers(path, trailingRaw[1], true);
  const outline = /^outline:(.*)$/u.exec(selector);
  if (outline)
    return { ...applyMembers(path, outline[1], false), outline: true };
  const raw = /^raw:(.*)$/u.exec(selector);
  if (raw) return applyMembers(path, raw[1], true);
  return applyMembers(path, selector, false);
}

/**
 * Apply validated members to a path. A single member is one window; a comma
 * request keeps its merged request for `requestedRanges` and reads the
 * context-grown intervals, with `offset` the first requested start for the
 * shared EOF rule. An end-relative member leaves the window pending until a
 * source count places it.
 */
function applyMembers(path: string, value: string, raw: boolean): ReadTarget {
  const parsed = parseMembers(value);
  if (parsed.endRelative.length > 0)
    return {
      path,
      offset: 0,
      raw,
      pending: {
        comma: parsed.comma,
        members: [...parsed.intervals, ...parsed.endRelative],
      },
    };
  return { path, raw, ...placeMembers(parsed.intervals, parsed.comma, raw) };
}

/**
 * Split the `path:selector` suffix off `input`: the `:raw` and `:outline`
 * forms claim everything after their marker, any other suffix splits at the
 * last colon past the last path separator, and everything else is a path with
 * no selector. A trailing `:raw` takes the colon segment before it as the
 * range list when that segment has the member-list shape and emits the
 * canonical `raw:<list>` spelling; any other segment stays on the path, so
 * `notes:draft:raw` is still the raw read of `notes:draft`. The suffix is
 * returned unvalidated — a caller that acts on it applies the shared grammar,
 * which rejects what the shape gate admits but the bounds do not.
 */
/** A native path split into its locator and optional read selector. */
export interface SelectorSplit {
  readonly path: string;
  readonly selector?: string;
}

export function splitSelectorSuffix(input: string): SelectorSplit {
  const raw = /:raw(?::([^:/]*))?$/.exec(input);
  if (raw) {
    const before = input.slice(0, raw.index);
    if (raw[1] !== undefined)
      return { path: before, selector: `raw:${raw[1]}` };
    return rawSplit(before);
  }
  const outline = /:outline(?::([^:/]*))?$/.exec(input);
  if (outline) {
    return {
      path: input.slice(0, outline.index),
      selector: input.slice(outline.index + 1),
    };
  }
  const colon = input.lastIndexOf(":");
  return colon > input.lastIndexOf("/")
    ? { path: input.slice(0, colon), selector: input.slice(colon + 1) }
    : { path: input };
}

/**
 * The `<list>:raw` spelling: the segment before a trailing `:raw` is the range
 * list only when it has the member-list shape, so a path segment that merely
 * ends in digits keeps its colon and stays the raw read of that path.
 */
function rawSplit(before: string): SelectorSplit {
  const colon = before.lastIndexOf(":");
  if (colon <= before.lastIndexOf("/"))
    return { path: before, selector: "raw" };
  const list = before.slice(colon + 1);
  return MEMBER_LIST.test(list)
    ? { path: before.slice(0, colon), selector: `raw:${list}` }
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
