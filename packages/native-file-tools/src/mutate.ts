import { randomUUID } from "node:crypto";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { NativeFileError } from "./path";
import {
  loadText,
  MAX_RESULT_CODE_UNITS,
  selectSourceLines,
  splitSourceLines,
} from "./read";
import { measureNativeModelOutput } from "./serialization";
import type { FileFailure, LineRange } from "./read";

type EditInput = { path: string; oldText: string; newText: string };
type WriteInput = { path: string; content: string };
type MutationSuccess = {
  status: "success";
  operation: "edit" | "write";
  path: string;
  replacements?: 1;
  created?: true;
  diff: string;
  content: string;
  shownRange: LineRange | null;
  truncated: boolean;
};

// A single host mutation queue also orders aliases of the same file. Reads stay independent.
let mutations: Promise<void> = Promise.resolve();

function mutate(
  operation: () => Promise<MutationSuccess>,
): Promise<MutationSuccess | FileFailure> {
  const pending = mutations.then(operation);
  mutations = pending.then(
    () => {},
    () => {},
  );
  return pending.catch((error: unknown): FileFailure => {
    if (error instanceof NativeFileError)
      return { status: "error", type: error.type, message: error.message };
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    const type =
      code === "ENOENT"
        ? "not_found"
        : code === "EEXIST"
          ? "file_exists"
          : "executor_unavailable";
    return {
      status: "error",
      type,
      message: "The native file operation could not complete.",
    };
  });
}

function validateContent(
  path: string,
  content: string,
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted();
  if (!isAbsolute(path) || path.includes("\0"))
    throw new NativeFileError("invalid_path");
  if (Buffer.from(content).toString("utf8") !== content)
    throw new NativeFileError("invalid_utf8");
}

async function publishFile(
  input: WriteInput,
  options: { create: boolean; mode?: number; signal?: AbortSignal },
): Promise<void> {
  const temporary = join(dirname(input.path), `.llame-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", options.mode ?? 0o666);
  try {
    await file.writeFile(input.content, "utf8");
    if (options.mode !== undefined) await file.chmod(options.mode);
    await file.sync();
    await file.close();
    options.signal?.throwIfAborted();
    if (options.create) await link(temporary, input.path);
    else await rename(temporary, input.path);
  } finally {
    await file.close().catch(() => {});
    // After successful publication, cleanup failure does not make the effect unknown.
    await unlink(temporary).catch(() => {});
  }
}

function describeMutation(
  input: WriteInput,
  region: { offset: number; limit: number; diff: string },
  operation: "edit" | "write",
): MutationSuccess {
  const read = selectSourceLines(input.content, {
    path: input.path,
    raw: false,
    offset: region.offset,
    limit: region.limit,
  });
  const result: MutationSuccess = {
    status: "success",
    operation,
    path: input.path,
    ...(operation === "edit"
      ? { replacements: 1 as const }
      : { created: true as const }),
    diff: region.diff,
    content: read.content,
    shownRange: read.shownRange,
    truncated: read.truncated,
  };
  return boundMutationResult(result);
}

function boundMutationResult(result: MutationSuccess): MutationSuccess {
  const diffLines = splitSourceLines(result.diff);
  result.diff = "";
  const contentLines = splitSourceLines(result.content);
  while (measureNativeModelOutput(result) > MAX_RESULT_CODE_UNITS) {
    result.truncated = true;
    if (contentLines.length === 0) throw new NativeFileError("invalid_path");
    contentLines.pop();
    result.content = contentLines.join("");
    if (result.shownRange && contentLines.length > 0)
      result.shownRange.endLine -= 1;
    else result.shownRange = null;
  }
  let low = 0;
  let high = diffLines.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = {
      ...result,
      diff: diffLines.slice(0, middle).join(""),
    };
    if (measureNativeModelOutput(candidate) <= MAX_RESULT_CODE_UNITS)
      low = middle;
    else high = middle - 1;
  }
  result.diff = diffLines.slice(0, low).join("");
  if (low < diffLines.length) result.truncated = true;
  return result;
}

function replacement(source: string, input: EditInput) {
  if (input.oldText.length === 0) throw new NativeFileError("invalid_input");
  const position = source.indexOf(input.oldText);
  if (position < 0) throw new NativeFileError("old_text_not_found");
  if (source.indexOf(input.oldText, position + 1) >= 0)
    throw new NativeFileError("old_text_ambiguous");
  const content =
    source.slice(0, position) +
    input.newText +
    source.slice(position + input.oldText.length);
  const line = source.slice(0, position).split("\n").length;
  const totalLines = splitSourceLines(content).length;
  const offset = Math.min(line - 1, Math.max(0, totalLines - 1));
  const diff =
    input.oldText === input.newText
      ? ""
      : `@@ replacement at line ${line} @@\n${input.oldText
          .split("\n")
          .map((text) => `-${text}`)
          .join("\n")}\n${input.newText
          .split("\n")
          .map((text) => `+${text}`)
          .join("\n")}\n`;
  return {
    content,
    offset,
    limit: input.newText.split("\n").length,
    diff,
  };
}

export function editFile(
  input: EditInput,
  signal?: AbortSignal,
): Promise<MutationSuccess | FileFailure> {
  return mutate(async () => {
    validateContent(input.path, input.newText, signal);
    const path = await realpath(input.path);
    const source = await loadText(path);
    const change = replacement(source, input);
    validateContent(path, change.content, signal);
    const result = describeMutation(
      { path: input.path, content: change.content },
      change,
      "edit",
    );
    if (input.oldText !== input.newText) {
      const stats = await lstat(path);
      await publishFile(
        { path, content: change.content },
        { create: false, mode: stats.mode & 0o777, signal },
      );
    }
    return result;
  });
}

export function createFile(
  input: WriteInput,
  signal?: AbortSignal,
): Promise<MutationSuccess | FileFailure> {
  return mutate(async () => {
    validateContent(input.path, "", signal);
    await requireAbsent(input.path);
    validateContent(input.path, input.content, signal);
    const result = describeMutation(
      input,
      { offset: 0, limit: 2000, diff: "" },
      "write",
    );
    await publishFile(input, { create: true, signal });
    return result;
  });
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  throw new NativeFileError("file_exists");
}
