import { lstat, mkdir, opendir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  compareEntries,
  createFile,
  DIRECTORY_TRAVERSAL_BUDGET,
  editFile,
  readResolvedFile,
  replaceFile,
  type EditSuccess,
  type FileFailure,
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
import {
  failure,
  FILE_READ_FAILED_MESSAGE,
  literalTargetOf,
  mediaTypeOf,
  MEDIA_SIGNATURE_HOOK,
  NOT_FOUND_MESSAGE,
  NOT_MEDIA_MESSAGE,
  OCTET_STREAM,
  readSignature,
  SIGNATURE_BYTES,
  spellingFailure,
  suggestionsSuppressed,
  tooLargeFailure,
} from "./file-targets";
import type { GuardedPath, RootGuard } from "./guard";
import {
  optionalBoolean,
  paramRecord,
  requireDisplayOptions,
  requireString,
} from "./params";
import type { OperationContext } from "./dispatch-types";

const NOT_REGULAR_FILE = "The target is not a regular file.";
const NOT_DIRECTORY_MESSAGE = "The target is not a directory.";
const LISTING_FAILED_MESSAGE = "The directory could not be listed.";

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

  return entries.sort(compareEntries);
}

export async function listOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsListResult> {
  const source = paramRecord(params, FS_LIST_METHOD);
  const path = requireString(source, "path", FS_LIST_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const spelling = await spellingFailure(path, guarded);

  if (spelling !== undefined) return spelling;

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
  selector: string | undefined,
  signal: AbortSignal,
): NativeReadOptions {
  return {
    displayPath,
    followSymlinks: true,
    // A listing never names where a link leads: a target outside the roots
    // would leak an address this Machine does not serve.
    linkTargets: false,
    selector,
    reserveCodeUnits: options.reserveCodeUnits,
    // An image or PDF refuses the text path by signature, before any decode,
    // so a PDF whose bytes happen to be ASCII still takes the bytes path.
    media: MEDIA_SIGNATURE_HOOK,
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

/**
 * A read hands the library the address the request means: the literal text
 * when it names an existing entry, otherwise the path the selector was split
 * from. The guard's normalised path is that same address for the split case,
 * and a trailing separator the caller wrote is refused above unless the
 * target is a directory.
 */
export async function readOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsReadResult> {
  const source = paramRecord(params, FS_READ_METHOD);
  const path = requireString(source, "path", FS_READ_METHOD);
  const options = requireDisplayOptions(source, FS_READ_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const spelling = await spellingFailure(path, guarded);

  if (spelling !== undefined) return spelling;

  if (suggestionsSuppressed(context.guard, guarded))
    return failure("not_found", NOT_FOUND_MESSAGE);

  const literal = await literalTargetOf(context.guard, path, options.selector);
  const requested = literal?.requested ?? path;
  const target = literal?.guarded ?? guarded;

  const result = await readResolvedFile(
    target.path,
    readOptions(
      options,
      displayPathFor(options.displayPrefix, target.path),
      literal === undefined ? options.selector : undefined,
      context.signal,
    ),
  );

  await verifyUnchanged(context.guard, requested, target);

  return withCanonicalPath(result, target, options.displayPrefix);
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
    // A parallel write may have created it since the existence check.
    await mkdir(directory).catch((error: unknown) => {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    });
    await guard.resolvePath(directory);
  }
}

/**
 * The edit answer without the replaced and replacement text. The hub sent both
 * strings in the call and rebuilds the display from them, so echoing them back
 * would carry a large replacement over one frame twice, and an answer that
 * outgrows the frame limit fails after the file has already changed. The start
 * line is the daemon's own, computed from the post-edit source.
 */
function withoutEchoedText(result: EditSuccess | FileFailure): FsMutateResult {
  if (result.status !== "success") return result;

  return { ...result, display: { startLine: result.display.startLine } };
}

export async function editOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsMutateResult> {
  const source = paramRecord(params, FS_EDIT_METHOD);
  const path = requireString(source, "path", FS_EDIT_METHOD);
  const options = requireDisplayOptions(source, FS_EDIT_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const spelling = await spellingFailure(path, guarded);

  if (spelling !== undefined) return spelling;

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

  return withoutEchoedText(result);
}

export async function writeOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<FsMutateResult> {
  const source = paramRecord(params, FS_WRITE_METHOD);
  const path = requireString(source, "path", FS_WRITE_METHOD);
  const options = requireDisplayOptions(source, FS_WRITE_METHOD);
  const guarded = await context.guard.resolvePath(path);
  const spelling = await spellingFailure(path, guarded);

  if (spelling !== undefined) return spelling;

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

/** Refuse a file whose leading bytes are not an image or PDF without a byte
 *  read, and hold an image or PDF over the media bound to the one wording its
 *  signature names. */
function nonMediaFailure(head: Buffer): NativeFailureResult | undefined {
  return mediaTypeOf(head) === OCTET_STREAM
    ? failure("unsupported_media_type", NOT_MEDIA_MESSAGE)
    : undefined;
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
  const spelling = await spellingFailure(path, guarded);

  if (spelling !== undefined) return spelling;

  if (guarded.kind !== "file")
    return failure("not_regular_file", NOT_REGULAR_FILE);
  const signature = await readSignature(guarded.canonical);

  if (signature === undefined)
    return failure("executor_unavailable", FILE_READ_FAILED_MESSAGE);
  const notMedia = nonMediaFailure(signature);

  // The signature decides before the size: a file matching none stays on the
  // text path whatever its size, and none of its bytes stream to the hub.
  if (notMedia !== undefined) return notMedia;

  if ((guarded.size ?? 0) > MEDIA_MAX_BYTES) return tooLargeFailure(signature);
  const bytes = await readFile(guarded.path);

  if (bytes.byteLength > MEDIA_MAX_BYTES)
    return tooLargeFailure(bytes.subarray(0, SIGNATURE_BYTES));
  // A file replaced between the probe and the read is judged by its own bytes.
  const swapped = nonMediaFailure(bytes);

  if (swapped !== undefined) return swapped;
  // Re-verify before any byte leaves, as `read` and `list` do.
  await verifyUnchanged(context.guard, path, guarded);
  sendChunks(context, bytes);

  return { size: bytes.byteLength, mediaType: mediaTypeOf(bytes) };
}
