import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export class NativeFileError extends Error {
  constructor(
    readonly type:
      | "invalid_path"
      | "invalid_selector"
      | "not_found"
      | "not_regular_file"
      | "file_too_large"
      | "invalid_utf8"
      | "executor_unavailable",
  ) {
    super(type);
  }
}

export type ReadTarget = {
  path: string;
  offset: number;
  limit?: number;
  raw: boolean;
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
  if (
    !isAbsolute(input) ||
    input.includes("\0") ||
    Buffer.byteLength(input) > 1024
  )
    throw new NativeFileError("invalid_path");
  try {
    await lstat(input);
    return { path: input, offset: 0, raw: false };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  return parseSelector(input);
}

function parseSelector(input: string): ReadTarget {
  const rawIndex = input.lastIndexOf(":raw");
  if (rawIndex >= 0 && !input.slice(rawIndex).includes("/")) {
    const suffix = input.slice(rawIndex + 4);
    if (suffix === "")
      return { path: input.slice(0, rawIndex), offset: 0, raw: true };
    if (!/^:\d+-\d+$/.test(suffix))
      throw new NativeFileError("invalid_selector");
    return {
      path: input.slice(0, rawIndex),
      ...parseRange(suffix.slice(1)),
      raw: true,
    };
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
