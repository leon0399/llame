import { constants } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

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
      | "directory_too_large",
  ) {
    super(type);
  }
}

export type ReadTarget = {
  path: string;
  offset: number;
  limit?: number;
  raw: boolean;
  directory?: boolean;
  /** Room withheld from the shared result cap for a caller's envelope. */
  reserveCodeUnits?: number;
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

function parseRange(value: string) {
  const match = /^(\d+)([-+])(\d+)$/.exec(value);
  if (!match) throw new NativeFileError("invalid_selector");
  const start = Number(match[1]);
  const operand = Number(match[3]);
  const end = match[2] === "+" ? start + (operand - 1) : operand;
  if (
    !Number.isSafeInteger(start) ||
    start < 1 ||
    !Number.isSafeInteger(operand) ||
    operand < 1 ||
    !Number.isSafeInteger(end) ||
    end < start
  ) {
    throw new NativeFileError("invalid_selector");
  }
  return { offset: start - 1, limit: end - start + 1 };
}
/** Input members stay bounded so metadata and normalization work do too. */
const MAX_SELECTOR_RANGES = 64;

function mergeIntervals(
  intervals: Array<{ offset: number; limit: number }>,
): Array<{ offset: number; limit: number }> {
  const sorted = [...intervals].sort((a, b) => a.offset - b.offset);
  const merged: Array<{ offset: number; limit: number }> = [];
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

/**
 * Split a comma selector and validate every member with the single-range
 * rules. The shape gate already enforced each member's form (raw members are
 * `N-M`), so `parseRange` only repeats the numeric checks here.
 */
function parseRanges(value: string): Array<{ offset: number; limit: number }> {
  const members = value.split(",");
  if (members.length > MAX_SELECTOR_RANGES)
    throw new NativeFileError("invalid_selector");
  return mergeIntervals(members.map(parseRange));
}

/**
 * Grow each merged interval one line per side and re-merge windows that now
 * overlap or sit adjacent. The trailing growth always applies; the reader
 * clips it at EOF. The leading growth clips at the first line here.
 */
function expandRanges(
  ranges: Array<{ offset: number; limit: number }>,
): Array<{ offset: number; limit: number }> {
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
    return { path: cleanPath, offset: 0, raw: false };
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

/**
 * The whole selector grammar, in one place. A caller that must distinguish a
 * malformed selector from a colon that was never a selector at all tests the
 * shape first; everything else applies it and lets `parseRange` reject the
 * ranges this shape admits but the bounds do not.
 */
const SELECTOR_SUFFIX =
  /^(?:raw(?::\d+-\d+(?:,\d+-\d+)*)?|\d+[-+]\d+(?:,\d+[-+]\d+)*)$/u;

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
  if (!isSelectorSuffix(selector))
    throw new NativeFileError("invalid_selector");
  const raw = /^raw:(.*)$/u.exec(selector);
  if (raw) return applyRangedSelector(path, raw[1], true);
  return applyRangedSelector(path, selector, false);
}

/**
 * Build a single- or multi-range target from validated members. A comma
 * request keeps its merged request for `requestedRanges` and reads the
 * context-grown intervals; `offset` stays the first requested start for the
 * shared EOF rule.
 */
function applyRangedSelector(
  path: string,
  members: string,
  raw: boolean,
): ReadTarget {
  if (!members.includes(",")) return { path, ...parseRange(members), raw };
  const ranges = parseRanges(members);
  return {
    path,
    offset: ranges[0].offset,
    raw,
    ranges,
    expandedRanges: raw
      ? ranges.map((range) => ({ ...range }))
      : expandRanges(ranges),
  };
}

/** Split a combined `path:selector` string, then apply the shared grammar. */
function parseSelector(input: string): ReadTarget {
  const raw = /:raw(?::([^:/]*))?$/.exec(input);
  if (raw) {
    const suffix = raw[1] === undefined ? "raw" : `raw:${raw[1]}`;
    return applySelectorSuffix(input.slice(0, raw.index), suffix);
  }
  const colon = input.lastIndexOf(":");
  return colon > input.lastIndexOf("/")
    ? applySelectorSuffix(input.slice(0, colon), input.slice(colon + 1))
    : applySelectorSuffix(input, undefined);
}

async function classifyParsedTarget(target: ReadTarget): Promise<ReadTarget> {
  try {
    if (await isDirectoryTarget(target.path)) {
      return { ...target, directory: true };
    }
  } catch {
    // Let downstream handle missing paths.
  }
  return target;
}
