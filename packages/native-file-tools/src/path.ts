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
    if (code !== "ENOENT") throw error;
  }
  if (hasTrailingSep) throw new NativeFileError("not_found");

  const parsed = parseSelector(input);
  return classifyParsedTarget(parsed);
}

/** Apply an already-split selector suffix to a path used verbatim. */
export function applySelectorSuffix(
  path: string,
  selector: string | undefined,
): ReadTarget {
  if (selector === undefined) return { path, offset: 0, raw: false };
  if (selector === "raw") return { path, offset: 0, raw: true };
  const raw = /^raw:(.*)$/u.exec(selector);
  if (raw) {
    if (!/^\d+-\d+$/.test(raw[1]))
      throw new NativeFileError("invalid_selector");
    return { path, ...parseRange(raw[1]), raw: true };
  }
  return { path, ...parseRange(selector), raw: false };
}

function parseSelector(input: string): ReadTarget {
  const raw = /:raw(?::([^:/]*))?$/.exec(input);
  if (raw) {
    const path = input.slice(0, raw.index);
    if (raw[1] === undefined) return { path, offset: 0, raw: true };
    if (!/^\d+-\d+$/.test(raw[1]))
      throw new NativeFileError("invalid_selector");
    return { path, ...parseRange(raw[1]), raw: true };
  }
  const colon = input.lastIndexOf(":");
  if (colon > input.lastIndexOf("/")) {
    return {
      path: input.slice(0, colon),
      ...parseRange(input.slice(colon + 1)),
      raw: false,
    };
  }
  return { path: input, offset: 0, raw: false };
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
