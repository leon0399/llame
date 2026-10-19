import { lstat, mkdir, opendir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createFile,
  DIRECTORY_TRAVERSAL_BUDGET,
  editFile,
  readResolvedFile,
  replaceFile,
  type NativeMutateOptions,
  type NativeReadOptions,
} from "@workspace/native-file-tools";
import {
  BYTES_CHUNK_BYTES,
  BYTES_NOTIFICATION,
  FS_BYTES_METHOD,
  FS_EDIT_METHOD,
  FS_LIST_METHOD,
  FS_READ_METHOD,
  FS_STAT_METHOD,
  FS_WRITE_METHOD,
  MEDIA_MAX_BYTES,
  PATH_NOT_REGISTERED_MESSAGE,
  type FsBytesResult,
  type FsListEntry,
  type FsListResult,
  type FsMutateResult,
  type FsReadResult,
  type FsStatResult,
  type NativeDisplayOptions,
  type NativeFailureResult,
  type SerializableValue,
} from "@workspace/machine-protocol";
import { MachineRequestError } from "./errors";
import type { GuardedPath, RootGuard } from "./guard";
import {
  optionalBoolean,
  paramRecord,
  requireDisplayOptions,
  requireString,
} from "./params";
import type { OperationContext } from "./dispatch-types";

const SIGNATURE_BYTES = 12;
const OCTET_STREAM = "application/octet-stream";
const NOT_REGULAR_FILE = "The target is not a regular file.";
const NOT_DIRECTORY_MESSAGE = "The target is not a directory.";
const LISTING_FAILED_MESSAGE = "The directory could not be listed.";
const MEDIA_TOO_LARGE_MESSAGE = "The file exceeds the media byte bound.";

function failure(
  type: NativeFailureResult["type"],
  message: string,
): NativeFailureResult {
  return { status: "error", type, message };
}

/** The Machine-locator form of a path: the hub supplies the `machine://name`. */
function displayPathFor(prefix: string, path: string): string {
  return `${prefix}${path}`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The contract's re-verification after opening: the same address must still
 * resolve to the same canonical location once the effect has run. A leaf or
 * ancestor swapped in the meantime resolves elsewhere and is refused.
 */
async function verifyUnchanged(
  guard: RootGuard,
  path: string,
  guarded: GuardedPath,
): Promise<void> {
  const after = await guard.resolvePath(path);
  if (after.canonical !== guarded.canonical)
    throw new MachineRequestError(
      "path_not_registered",
      PATH_NOT_REGISTERED_MESSAGE,
    );
}

export async function statOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsStatResult> {
  const source = paramRecord(params, FS_STAT_METHOD);
  const guarded = await context.guard.resolvePath(
    requireString(source, "path", FS_STAT_METHOD),
  );
  const stat: FsStatResult = { kind: guarded.kind, isLink: guarded.isLink };
  return guarded.kind === "missing"
    ? stat
    : { ...stat, realPath: guarded.canonical, size: guarded.size };
}

async function entriesOf(directory: string): Promise<Array<FsListEntry>> {
  const entries: Array<FsListEntry> = [];
  // The async iterator closes the handle when it completes.
  for await (const entry of await opendir(directory)) {
    entries.push({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? "link"
        : entry.isDirectory()
          ? "directory"
          : entry.isFile()
            ? "file"
            : "other",
    });
  }
  return entries.sort((left, right) => {
    const leftDirectory = left.kind === "directory" ? 0 : 1;
    const rightDirectory = right.kind === "directory" ? 0 : 1;
    return leftDirectory === rightDirectory
      ? left.name.localeCompare(right.name)
      : leftDirectory - rightDirectory;
  });
}

export async function listOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsListResult> {
  const source = paramRecord(params, FS_LIST_METHOD);
  const path = requireString(source, "path", FS_LIST_METHOD);
  const guarded = await context.guard.resolvePath(path);
  if (guarded.kind !== "directory")
    return failure("not_regular_file", NOT_DIRECTORY_MESSAGE);
  let entries: Array<FsListEntry>;
  try {
    entries = await entriesOf(guarded.path);
  } catch {
    return failure("executor_unavailable", LISTING_FAILED_MESSAGE);
  }
  await verifyUnchanged(context.guard, path, guarded);
  return {
    entries: entries.slice(0, DIRECTORY_TRAVERSAL_BUDGET),
    totalCount: entries.length,
    truncated: entries.length > DIRECTORY_TRAVERSAL_BUDGET,
  };
}

function readOptions(
  options: NativeDisplayOptions,
  displayPath: string,
  signal: AbortSignal,
): NativeReadOptions {
  return {
    displayPath,
    followSymlinks: true,
    // A listing never names where a link leads: a target outside the roots
    // would leak an address this Machine does not serve.
    linkTargets: false,
    selector: options.selector,
    reserveCodeUnits: options.reserveCodeUnits,
    signal,
  };
}

/**
 * A read reports the canonical location only when the address resolves
 * elsewhere, exactly as a local read does; the reported path is a locator.
 */
function withCanonicalPath(
  result: FsReadResult,
  guarded: GuardedPath,
  prefix: string,
): FsReadResult {
  if (result.status !== "success" || result.kind !== "file") return result;
  return guarded.canonical === guarded.path
    ? result
    : { ...result, realPath: displayPathFor(prefix, guarded.canonical) };
}

export async function readOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsReadResult> {
  const source = paramRecord(params, FS_READ_METHOD);
  const path = requireString(source, "path", FS_READ_METHOD);
  const options = requireDisplayOptions(source, FS_READ_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const result = await readResolvedFile(
    guarded.path,
    readOptions(
      options,
      displayPathFor(options.displayPrefix, guarded.path),
      context.signal,
    ),
  );
  await verifyUnchanged(context.guard, path, guarded);
  return withCanonicalPath(result, guarded, options.displayPrefix);
}

function mutateOptions(
  options: NativeDisplayOptions,
  guarded: GuardedPath,
): NativeMutateOptions {
  return {
    displayPath: displayPathFor(options.displayPrefix, guarded.path),
    reserveCodeUnits: options.reserveCodeUnits,
  };
}

/** One component at a time, each re-checked against the roots. */
async function createParentDirectories(
  guard: RootGuard,
  target: string,
): Promise<void> {
  const missing: Array<string> = [];
  let current = dirname(target);
  while (current !== dirname(current) && !(await pathExists(current))) {
    missing.push(current);
    current = dirname(current);
  }
  for (const directory of missing.reverse()) {
    await mkdir(directory);
    await guard.resolvePath(directory);
  }
}

export async function editOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsMutateResult> {
  const source = paramRecord(params, FS_EDIT_METHOD);
  const path = requireString(source, "path", FS_EDIT_METHOD);
  const options = requireDisplayOptions(source, FS_EDIT_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const result = await editFile(
    {
      path: guarded.canonical,
      oldText: requireString(source, "oldText", FS_EDIT_METHOD),
      newText: requireString(source, "newText", FS_EDIT_METHOD),
    },
    context.signal,
    mutateOptions(options, guarded),
  );
  await verifyUnchanged(context.guard, path, guarded);
  return result;
}

export async function writeOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsMutateResult> {
  const source = paramRecord(params, FS_WRITE_METHOD);
  const path = requireString(source, "path", FS_WRITE_METHOD);
  const options = requireDisplayOptions(source, FS_WRITE_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const input = {
    path: guarded.canonical,
    content: requireString(source, "content", FS_WRITE_METHOD),
  };
  const replace = optionalBoolean(source, "replace", FS_WRITE_METHOD) === true;
  if (!replace) await createParentDirectories(context.guard, guarded.canonical);
  const result = replace
    ? await replaceFile(input, context.signal, mutateOptions(options, guarded))
    : await createFile(input, context.signal, mutateOptions(options, guarded));
  await verifyUnchanged(context.guard, path, guarded);
  return result;
}

function mediaTypeOf(bytes: Buffer): string {
  const head = bytes.subarray(0, SIGNATURE_BYTES).toString("latin1");
  if (head.startsWith("\u0089PNG\r\n\u001a\n")) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a"))
    return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")
    return "image/webp";
  if (head.startsWith("%PDF-")) return "application/pdf";
  return OCTET_STREAM;
}

function sendChunks(context: OperationContext, bytes: Buffer): void {
  for (
    let offset = 0, seq = 1;
    offset < bytes.byteLength;
    offset += BYTES_CHUNK_BYTES, seq += 1
  ) {
    context.signal.throwIfAborted();
    context.notify(BYTES_NOTIFICATION, {
      seq,
      data: bytes
        .subarray(offset, offset + BYTES_CHUNK_BYTES)
        .toString("base64"),
    });
  }
}

export async function bytesOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsBytesResult> {
  const source = paramRecord(params, FS_BYTES_METHOD);
  const path = requireString(source, "path", FS_BYTES_METHOD);
  const guarded = await context.guard.resolvePath(path);
  if (guarded.kind !== "file")
    return failure("not_regular_file", NOT_REGULAR_FILE);
  const tooLarge = failure("media_too_large", MEDIA_TOO_LARGE_MESSAGE);
  if ((guarded.size ?? 0) > MEDIA_MAX_BYTES) return tooLarge;
  const bytes = await readFile(guarded.path);
  // The size probe and the read are two syscalls; the bytes themselves decide.
  if (bytes.byteLength > MEDIA_MAX_BYTES) return tooLarge;
  // Re-verify before any byte leaves, as `read` and `list` do.
  await verifyUnchanged(context.guard, path, guarded);
  sendChunks(context, bytes);
  return { size: bytes.byteLength, mediaType: mediaTypeOf(bytes) };
}
