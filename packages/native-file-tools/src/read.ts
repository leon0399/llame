import { lstat, opendir, open } from "node:fs/promises";
import {
  applySelectorSuffix,
  isNodeError,
  NativeFileError,
  openFlags,
  resolveReadTarget,
  type ReadTarget,
} from "./path";
import { streamFileWindow } from "./stream-read";
import { missingFileMessage } from "./read-suggestions";
import {
  listDirectory,
  type DirectoryListingOptions,
  type DirectoryPort,
  type DirectorySuccess,
  type DirectoryFailure,
} from "./directory-listing";
import type { ReadSuccess, FileFailure } from "./source-lines";
export * from "./source-lines";
export type { DirectorySuccess, DirectoryFailure } from "./directory-listing";
export {
  DIRECTORY_TRAVERSAL_BUDGET,
  DIRECTORY_CHILD_CAP,
} from "./directory-listing";

const NODE_DIRECTORY_PORT: DirectoryPort = {
  opendir: (path) => opendir(path),
};

type ReadOutcome =
  | ReadSuccess
  | DirectorySuccess
  | DirectoryFailure
  | FileFailure;

/**
 * What a scheme resolver supplies once it has authorized the caller and
 * resolved the host path. `displayPath` is what the model sees, so the result
 * carries it and is bounded against it rather than against the host path;
 * `selector` is the suffix the resolver already split off, so no literal-path
 * probe can reinterpret it; and `reserveCodeUnits` withholds room for the
 * envelope the resolver wraps the result in, so the shared cap still holds for
 * what the model receives.
 *
 * A resolved target is always opened with `O_NOFOLLOW` and a symbolic link is
 * always refused. A scheme owner authorized one specific entry, so following a
 * link would serve a different one, and there is no caller for whom that is
 * correct.
 */
export type NativeReadOptions = {
  readonly displayPath: string;
  readonly selector?: string;
  readonly reserveCodeUnits?: number;
  readonly signal?: AbortSignal | undefined;
};

export async function loadText(
  path: string,
  followSymlinks = true,
): Promise<string> {
  const file = await open(path, openFlags(followSymlinks));
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new NativeFileError("not_regular_file");
    const buffer = await file.readFile();
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer,
      );
    } catch {
      throw new NativeFileError("invalid_utf8");
    }
  } finally {
    await file.close();
  }
}

export async function readFile(
  input: { path: string },
  signal?: AbortSignal,
): Promise<ReadOutcome> {
  let hostPath = input.path;
  try {
    const target = await resolveReadTarget(input.path);
    hostPath = target.path;
    return target.directory
      ? await runListing(target.path, target)
      : await streamFileWindow(target, {
          hostPath: target.path,
          followSymlinks: true,
          signal,
        });
  } catch (error) {
    return readFailure(error, hostPath, input.path, true);
  }
}

/** Read a target a scheme resolver has already authorized and resolved. */
export async function readResolvedFile(
  hostPath: string,
  options: NativeReadOptions,
): Promise<ReadOutcome> {
  try {
    const target = await resolveResolvedTarget(hostPath, options);
    return target.directory
      ? await runListing(hostPath, target)
      : await streamFileWindow(target, {
          hostPath,
          followSymlinks: false,
          signal: options.signal,
        });
  } catch (error) {
    return readFailure(error, hostPath, options.displayPath, false);
  }
}

/**
 * The host path is used verbatim here: no literal-path probe, no scheme
 * parsing, and a symbolic link is never a directory when links are refused.
 */
async function resolveResolvedTarget(
  hostPath: string,
  options: NativeReadOptions,
): Promise<ReadTarget> {
  const target = applySelectorSuffix(options.displayPath, options.selector);
  if (options.reserveCodeUnits !== undefined)
    target.reserveCodeUnits = options.reserveCodeUnits;
  const stats = await lstat(hostPath);
  if (stats.isSymbolicLink()) throw new NativeFileError("not_found");
  return stats.isDirectory() ? { ...target, directory: true } : target;
}

function runListing(
  hostPath: string,
  target: ReadTarget,
): Promise<DirectorySuccess | DirectoryFailure> | FileFailure {
  if (target.raw)
    return {
      status: "error",
      type: "invalid_selector",
      message: "The :raw selector is not supported for directory reads.",
    };
  const options: DirectoryListingOptions = { displayPath: target.path };
  if (target.offset > 0 || target.limit !== undefined) {
    options.offset = target.offset;
    options.limit = target.limit;
  }
  if (target.reserveCodeUnits !== undefined)
    options.reserveCodeUnits = target.reserveCodeUnits;
  return listDirectory(hostPath, NODE_DIRECTORY_PORT, options);
}

async function readFailure(
  error: unknown,
  hostPath: string,
  displayPath: string,
  followSymlinks: boolean,
): Promise<FileFailure> {
  if (error instanceof NativeFileError)
    return { status: "error", type: error.type, message: error.message };
  const code = isNodeError(error) ? error.code : undefined;
  const type =
    code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP"
      ? "not_found"
      : "executor_unavailable";
  if (
    code === "ENOENT" &&
    !hostPath.endsWith("/") &&
    !displayPath.endsWith("/")
  ) {
    return {
      status: "error",
      type: "not_found",
      message: await missingFileMessage(hostPath, followSymlinks),
    };
  }
  return {
    status: "error",
    type,
    message:
      type === "not_found" ? "File not found." : "File could not be read.",
  };
}
