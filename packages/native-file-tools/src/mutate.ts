import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isNodeError, NativeFileError, parsePathScheme } from "./path";
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

/**
 * What a scheme resolver supplies once it has authorized and resolved the
 * target. `displayPath` is what the model sees in place of the host path, and
 * its presence marks the target as already resolved: it is never resolved
 * again through a symbolic link, because the owner authorized one specific
 * entry and following a link would mutate another. `reserveCodeUnits`
 * withholds room for the envelope the resolver wraps the result in, so the
 * preview is bounded against what the model receives rather than truncated
 * generically afterwards.
 */
export type NativeMutateOptions = {
  readonly displayPath?: string | undefined;
  readonly reserveCodeUnits?: number | undefined;
};
type MutationSuccess = {
  status: "success";
  operation: "edit" | "write";
  path: string;
  replacements?: 1;
  created?: true;
  replaced?: true;
  diff: string;
  content: string;
  shownRange: LineRange | null;
  truncated: boolean;
};

/** An existing target is the create mode's refusal, and the message names the
 *  two ways forward so the caller that wanted an existing file is not left
 *  re-deriving them from the flag it passed. */
const FILE_EXISTS_MESSAGE =
  "The target already exists. Pass replace: true to replace its contents, or use edit for a partial change.";

/** The replace mode's refusal: the caller asserted the target exists, so the
 *  message says what replace requires and what creating it takes. Exported
 *  because a scheme resolver can refuse the same target before the mutation
 *  runs, and the wording must not differ by scheme. */
export const REPLACE_TARGET_MISSING_MESSAGE =
  "The replace target does not exist. replace requires an existing file; omit replace to create a new file.";

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
    const code = isNodeError(error) ? error.code : undefined;
    // `ELOOP` is `O_NOFOLLOW` refusing a symbolic link at a resolved target,
    // which reads report as `not_found`; `ENOTDIR` is a path component that
    // exists but is not a directory.
    const type =
      code === "ENOENT" || code === "ELOOP"
        ? "not_found"
        : code === "EEXIST"
          ? "file_exists"
          : code === "ENOTDIR"
            ? "not_regular_file"
            : "executor_unavailable";
    return {
      status: "error",
      type,
      message:
        type === "file_exists"
          ? FILE_EXISTS_MESSAGE
          : "The native file operation could not complete.",
    };
  });
}

function validateContent(
  path: string,
  content: string,
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted();
  if (parsePathScheme(path) || !isAbsolute(path) || path.includes("\0"))
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
  kind: "edit" | "create" | "replace",
  options: NativeMutateOptions = {},
): MutationSuccess {
  const displayPath = options.displayPath ?? input.path;
  const reserve = options.reserveCodeUnits ?? 0;
  const read = selectSourceLines(input.content, {
    path: displayPath,
    raw: false,
    offset: region.offset,
    limit: region.limit,
    reserveCodeUnits: reserve,
  });
  const result: MutationSuccess = {
    status: "success",
    operation: kind === "edit" ? "edit" : "write",
    path: displayPath,
    ...(kind === "edit"
      ? { replacements: 1 as const }
      : kind === "replace"
        ? { replaced: true as const }
        : { created: true as const }),
    diff: region.diff,
    content: read.content,
    shownRange: read.shownRange,
    truncated: read.truncated,
  };
  return boundMutationResult(result, reserve);
}

function boundMutationResult(
  result: MutationSuccess,
  reserveCodeUnits: number,
): MutationSuccess {
  const cap = MAX_RESULT_CODE_UNITS - reserveCodeUnits;
  const diffLines = splitSourceLines(result.diff);
  result.diff = "";
  const contentLines = splitSourceLines(result.content);
  while (measureNativeModelOutput(result) > cap) {
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
    if (measureNativeModelOutput(candidate) <= cap) low = middle;
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
  options: NativeMutateOptions = {},
): Promise<MutationSuccess | FileFailure> {
  return mutate(async () => {
    const displayPath = options.displayPath;
    validateContent(input.path, input.newText, signal);
    // An absolute path is the host's own; a resolved target was authorized as
    // one exact entry, so resolving it through a link would edit another.
    const path =
      displayPath === undefined ? await realpath(input.path) : input.path;
    const source = await loadText(path, displayPath === undefined);
    const change = replacement(source, input);
    validateContent(path, change.content, signal);
    const result = describeMutation(
      { path: input.path, content: change.content },
      change,
      "edit",
      { displayPath, reserveCodeUnits: options.reserveCodeUnits },
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
  options: NativeMutateOptions = {},
): Promise<MutationSuccess | FileFailure> {
  return mutate(async () => {
    const displayPath = options.displayPath;
    validateContent(input.path, "", signal);
    await requireAbsent(input.path);
    validateContent(input.path, input.content, signal);
    const result = describeMutation(
      input,
      { offset: 0, limit: 2000, diff: "" },
      "create",
      { displayPath, reserveCodeUnits: options.reserveCodeUnits },
    );
    // A resolved target's directories were created by its scheme owner, one
    // component at a time under its own symlink refusal; a recursive create
    // here would resolve through a link the owner just refused.
    if (displayPath === undefined) await createParentDirectories(input.path);
    await publishFile(input, { create: true, signal });
    return result;
  });
}

/**
 * Replace publishes over a target the caller asserted exists. An absent one is
 * the intended signal rather than an incidental filesystem failure, so it
 * reports the replace contract instead of the generic message. An absolute
 * path resolves through symbolic links exactly as `edit` does, so a link is
 * replaced at the entry it points to and survives the rewrite; a resolved
 * target was authorized as one exact entry, and following a link from it would
 * replace another.
 */
async function resolveReplaceTarget(
  path: string,
  followSymlinks: boolean,
): Promise<{ path: string; mode: number }> {
  try {
    const resolved = followSymlinks ? await realpath(path) : path;
    const stats = await lstat(resolved);
    if (!stats.isFile()) throw new NativeFileError("not_regular_file");
    return { path: resolved, mode: stats.mode & 0o777 };
  } catch (error) {
    if (error instanceof NativeFileError) throw error;
    if (isNodeError(error) && error.code === "ENOENT")
      throw new NativeFileError("not_found", REPLACE_TARGET_MISSING_MESSAGE);
    throw error;
  }
}

export function replaceFile(
  input: WriteInput,
  signal?: AbortSignal,
  options: NativeMutateOptions = {},
): Promise<MutationSuccess | FileFailure> {
  return mutate(async () => {
    const displayPath = options.displayPath;
    validateContent(input.path, "", signal);
    const target = await resolveReplaceTarget(
      input.path,
      displayPath === undefined,
    );
    validateContent(input.path, input.content, signal);
    const result = describeMutation(
      input,
      { offset: 0, limit: 2000, diff: "" },
      "replace",
      { displayPath, reserveCodeUnits: options.reserveCodeUnits },
    );
    await publishFile(
      { path: target.path, content: input.content },
      { create: false, mode: target.mode, signal },
    );
    return result;
  });
}

/**
 * A write names the file it wants, not the directories above it, so the
 * missing ones are created. An existing component that is not a directory is
 * the caller's mistake and nothing is created.
 */
async function createParentDirectories(path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (error) {
    // An existing component that is not a directory is `ENOTDIR`; an existing
    // directory is not an error for a recursive create at all.
    if (isNodeError(error) && error.code === "ENOTDIR")
      throw new NativeFileError("not_regular_file");
    throw error;
  }
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new NativeFileError("file_exists", FILE_EXISTS_MESSAGE);
}
