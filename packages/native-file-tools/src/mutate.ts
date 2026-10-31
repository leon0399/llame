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
  renderSourceLine,
  splitSourceLines,
} from "./read";
import { measureEditRendering } from "./model-text";
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
/** Display-only data for the owner UI: the exact replaced and replacement
 *  text, with the post-edit line the region starts at. The model never sees
 *  it, so it does not count against the bound. */
type MutationDisplay = {
  startLine: number;
  oldText: string;
  newText: string;
};

/** A completed edit: the numbered post-edit region, where it starts, and the
 *  display data the owner UI diffs. The model reads the rendering of these
 *  fields, never the display data. */
export type EditSuccess = {
  status: "success";
  operation: "edit";
  path: string;
  replacements: 1;
  content: string;
  shownRange: LineRange | null;
  truncated: boolean;
  lineCount: number;
  display: MutationDisplay;
};

type WriteSuccess = {
  status: "success";
  operation: "write";
  path: string;
  created?: true;
  replaced?: true;
  lineCount: number;
};

type MutationSuccess = EditSuccess | WriteSuccess;

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

/**
 * `notFoundMessage` names what the caller can do about a `not_found` the
 * filesystem reported rather than the operation; an operation that asserts the
 * target exists supplies it, and every other operation keeps the generic one.
 */
function mutate<Result extends MutationSuccess>(
  operation: () => Promise<Result>,
  notFoundMessage?: string,
): Promise<Result | FileFailure> {
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
          : type === "not_found" && notFoundMessage !== undefined
            ? notFoundMessage
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

/** How many live lines of context each side of the changed lines the stored
 *  post-edit region keeps. */
const EDIT_CONTEXT_LINES = 2;

/** The post-edit source and where the replacement landed: its 1-based start
 *  line and the number of post-edit lines it occupies, zero when it deleted
 *  text without inserting any. */
type EditChange = {
  content: string;
  line: number;
  replacementLines: number;
};

/** A write is status only: the stored locator, the created/replaced marker,
 *  and the written file's line count. Its content is never stored, so the
 *  owner UI renders it from the call's argument. */
function describeWrite(
  input: WriteInput,
  kind: "create" | "replace",
  options: NativeMutateOptions = {},
): WriteSuccess {
  return {
    status: "success",
    operation: "write",
    path: options.displayPath ?? input.path,
    ...(kind === "replace"
      ? { replaced: true as const }
      : { created: true as const }),
    lineCount: splitSourceLines(input.content).length,
  };
}

/** The numbered lines of a stored region, from its 1-based bounds. */
function regionContent(lines: Array<string>, range: LineRange): string {
  return lines
    .slice(range.startLine - 1, range.endLine)
    .map((text, index) => renderSourceLine(text, range.startLine - 1 + index))
    .join("");
}

/** The numbered post-edit region of an edit: the changed lines plus two live
 *  lines each side, clamped to the file. */
function describeEdit(
  input: EditInput,
  change: EditChange,
  options: NativeMutateOptions = {},
): EditSuccess {
  const lines = splitSourceLines(change.content);
  const lineCount = lines.length;
  const startLine = Math.max(1, change.line - EDIT_CONTEXT_LINES);
  const endLine = Math.min(
    lineCount,
    change.line + Math.max(change.replacementLines - 1, 0) + EDIT_CONTEXT_LINES,
  );
  const shownRange = lineCount === 0 ? null : { startLine, endLine };
  return boundMutationResult(
    {
      status: "success",
      operation: "edit",
      path: options.displayPath ?? input.path,
      replacements: 1,
      content: shownRange === null ? "" : regionContent(lines, shownRange),
      shownRange,
      truncated: false,
      lineCount,
      display: {
        startLine: change.line,
        oldText: input.oldText,
        newText: input.newText,
      },
    },
    options.reserveCodeUnits ?? 0,
  );
}

/**
 * Shrink the numbered region from its end until the model rendering fits what
 * the caller's envelope left of the shared cap, marking the cut. Only `content`
 * shrinks: the display data is never rendered and the line count is one number
 * (tool-result-rendering "Bounds are measured on the neutralized rendering").
 */
function boundMutationResult(
  result: EditSuccess,
  reserveCodeUnits: number,
): EditSuccess {
  const cap = MAX_RESULT_CODE_UNITS - reserveCodeUnits;
  if (measureEditRendering(result) <= cap) return result;
  result.truncated = true;
  const lines = splitSourceLines(result.content);
  // The cut marker is fixed width and the region only shrinks, so the widest
  // prefix that fits is the longest one the binary search accepts.
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const content = lines.slice(0, middle).join("");
    if (measureEditRendering({ ...result, content }) <= cap) low = middle;
    else high = middle - 1;
  }
  const content = lines.slice(0, low).join("");
  // Only a header wider than the whole cap leaves nothing to keep.
  if (measureEditRendering({ ...result, content }) > cap)
    throw new NativeFileError("invalid_path");
  result.content = content;
  const startLine = result.shownRange?.startLine;
  result.shownRange =
    startLine === undefined || low === 0
      ? null
      : { startLine, endLine: startLine + low - 1 };
  return result;
}

function replacement(source: string, input: EditInput): EditChange {
  if (input.oldText.length === 0) throw new NativeFileError("invalid_input");
  const position = source.indexOf(input.oldText);
  if (position < 0) throw new NativeFileError("old_text_not_found");
  if (source.indexOf(input.oldText, position + 1) >= 0)
    throw new NativeFileError("old_text_ambiguous");
  return {
    content:
      source.slice(0, position) +
      input.newText +
      source.slice(position + input.oldText.length),
    line: source.slice(0, position).split("\n").length,
    replacementLines: splitSourceLines(input.newText).length,
  };
}

export function editFile(
  input: EditInput,
  signal?: AbortSignal,
  options: NativeMutateOptions = {},
): Promise<EditSuccess | FileFailure> {
  return mutate<EditSuccess>(async () => {
    const displayPath = options.displayPath;
    validateContent(input.path, input.newText, signal);
    // An absolute path is the host's own; a resolved target was authorized as
    // one exact entry, so resolving it through a link would edit another.
    const path =
      displayPath === undefined ? await realpath(input.path) : input.path;
    const source = await loadText(path, displayPath === undefined);
    const change = replacement(source, input);
    validateContent(path, change.content, signal);
    const result = describeEdit(input, change, {
      displayPath,
      reserveCodeUnits: options.reserveCodeUnits,
    });
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
): Promise<WriteSuccess | FileFailure> {
  return mutate<WriteSuccess>(async () => {
    const displayPath = options.displayPath;
    validateContent(input.path, "", signal);
    await requireAbsent(input.path);
    validateContent(input.path, input.content, signal);
    const result = describeWrite(input, "create", { displayPath });
    // A resolved target's directories were created by its scheme owner, one
    // component at a time under its own symlink refusal; a recursive create
    // here would resolve through a link the owner just refused.
    if (displayPath === undefined) await createParentDirectories(input.path);
    await publishFile(input, { create: true, signal });
    return result;
  });
}

/**
 * An absolute path resolves through symbolic links exactly as `edit` does, so
 * a link is replaced at the entry it points to and survives the rewrite. A
 * resolved target was authorized as one exact entry, and following a link from
 * it would replace another, so a link swapped in at it is refused as the
 * reader refuses one: `not_found`, with the bare type, because an entry does
 * occupy the path and the replace contract's advice would be wrong there.
 *
 * A target that does not resolve is the assertion failing rather than an
 * incidental filesystem failure, so `replaceFile` answers the mutation's
 * `not_found` with the replace contract.
 */
async function resolveReplaceTarget(
  path: string,
  followSymlinks: boolean,
): Promise<{ path: string; mode: number }> {
  const resolved = followSymlinks ? await realpath(path) : path;
  const stats = await lstat(resolved);
  if (stats.isSymbolicLink() && !followSymlinks)
    throw new NativeFileError("not_found");
  if (!stats.isFile()) throw new NativeFileError("not_regular_file");
  return { path: resolved, mode: stats.mode & 0o777 };
}

export function replaceFile(
  input: WriteInput,
  signal?: AbortSignal,
  options: NativeMutateOptions = {},
): Promise<WriteSuccess | FileFailure> {
  return mutate<WriteSuccess>(async () => {
    const displayPath = options.displayPath;
    validateContent(input.path, "", signal);
    const target = await resolveReplaceTarget(
      input.path,
      displayPath === undefined,
    );
    validateContent(input.path, input.content, signal);
    const result = describeWrite(input, "replace", { displayPath });
    await publishFile(
      { path: target.path, content: input.content },
      { create: false, mode: target.mode, signal },
    );
    return result;
  }, REPLACE_TARGET_MISSING_MESSAGE);
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
