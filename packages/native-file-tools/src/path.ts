import { lstat, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

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
};

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

export async function resolveReadTarget(input: string): Promise<ReadTarget> {
  if (!isAbsolute(input) || input.includes("\0"))
    throw new NativeFileError("invalid_path");

  const hasTrailingSep = input.length > 1 && input.endsWith("/");
  const cleanPath = hasTrailingSep ? input.slice(0, -1) : input;

  try {
    const lstats = await lstat(cleanPath);
    if (lstats.isDirectory()) {
      return { path: cleanPath, offset: 0, raw: false, directory: true };
    }
    if (lstats.isSymbolicLink()) {
      const target = await stat(cleanPath);
      if (target.isDirectory()) {
        return { path: cleanPath, offset: 0, raw: false, directory: true };
      }
    }
    if (hasTrailingSep) throw new NativeFileError("not_found");
    return { path: cleanPath, offset: 0, raw: false };
  } catch (error) {
    if (error instanceof NativeFileError) throw error;
    if (!(error instanceof Error) || !("code" in error)) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR") throw new NativeFileError("not_found");
    if (code !== "ENOENT") throw error;
  }
  if (hasTrailingSep) throw new NativeFileError("not_found");

  const parsed = parseSelector(input);
  return classifyParsedTarget(parsed);
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
    const lstats = await lstat(target.path);
    if (lstats.isDirectory()) return { ...target, directory: true };
    if (lstats.isSymbolicLink()) {
      const s = await stat(target.path);
      if (s.isDirectory()) return { ...target, directory: true };
    }
  } catch {
    // Let downstream handle missing paths.
  }
  return target;
}
