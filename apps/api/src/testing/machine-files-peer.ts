/**
 * A real `MachineConnector` whose own Machine answers the file methods
 * against the real filesystem (host-as-machine layer 3). After that layer the
 * host file tools go through the Machine surface like any other Machine, and
 * the api unit project cannot build the daemon bundle, so unit tests need a
 * daemon peer that can read and write real files. The answers mirror
 * `apps/machine/src/guard.ts` and `apps/machine/src/files.ts`: root
 * enforcement, the same `@workspace/native-file-tools` operations, and the
 * same wire shapes. The daemon suite owns the behaviour's parity; this module
 * exists so a tool test keeps asserting user-visible results.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { mkdir, open, opendir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  ROOTS_LIST_METHOD,
  type FsListEntry,
  type FsListResult,
  type FsMutateResult,
  type FsReadResult,
  type FsStatResult,
  type JsonValue,
  type NativeDisplayOptions,
  type NativeFailureResult,
} from '@workspace/machine-protocol';
import {
  createFile,
  DIRECTORY_TRAVERSAL_BUDGET,
  editFile,
  readResolvedFile,
  replaceFile,
  type EditSuccess,
  type FileFailure,
  type NativeReadOptions,
} from '@workspace/native-file-tools';
import { isRecord, isString } from '@workspace/runtime-safety';
import { z } from 'zod';

import { MachineConnector } from '../machines/machine-connector.service';
import {
  PeerRefusal,
  rootGuard,
  type GuardedPath,
} from './machine-files-guard';
import {
  createProtocolPeer,
  type PeerAnswer,
  type PeerCall,
  type ProtocolPeer,
} from './machine-protocol-peer';

/** The default local Machine name the helper configures. */
const DEFAULT_NAME = 'host-a';

const SIGNATURE_BYTES = 12;
const OCTET_STREAM = 'application/octet-stream';
const NOT_REGULAR_FILE = 'The target is not a regular file.';
const NOT_DIRECTORY_MESSAGE = 'The target is not a directory.';
const LISTING_FAILED_MESSAGE = 'The directory could not be listed.';
const MEDIA_TOO_LARGE_MESSAGE = 'The file exceeds the media byte bound.';
const IMAGE_TOO_LARGE_MESSAGE = 'Image exceeds 20 MiB or 40 megapixels';
const PDF_TOO_LARGE_MESSAGE = 'PDF exceeds 20 MiB or 100 pages';

export type MachineFilesPeerOptions = {
  /** `machines.local` and `machines.default`, both this name. */
  readonly name?: string;
  /** The registered roots; a path outside all of them is refused. Default `/`. */
  readonly roots?: ReadonlyArray<string>;
  /** Consulted before the default answers, for methods this peer does not serve. */
  readonly answer?: (
    call: PeerCall,
  ) => PeerAnswer | Promise<PeerAnswer> | undefined;
};

export type MachineFilesConnector = MachineConnector & {
  /** The daemon side; its sessions hold the requests the tools sent. */
  readonly peer: ProtocolPeer;
};

function failure(
  type: FileFailure['type'],
  message: string,
): NativeFailureResult {
  return { status: 'error', type, message };
}

function readOptions(
  options: NativeDisplayOptions,
  displayPath: string,
  signal: AbortSignal,
): NativeReadOptions {
  return {
    displayPath,
    followSymlinks: true,
    linkTargets: false,
    selector: options.selector,
    reserveCodeUnits: options.reserveCodeUnits,
    signal,
  };
}

function withCanonicalPath(
  result: FsReadResult,
  guarded: GuardedPath,
  prefix: string,
): FsReadResult {
  if (result.status !== 'success' || result.kind !== 'file') return result;

  return guarded.canonical === guarded.path
    ? result
    : { ...result, realPath: `${prefix}${guarded.canonical}` };
}

/** The path and display options a read, edit, or write request carries. */
type FileRequest = {
  readonly path: string;
  readonly options: NativeDisplayOptions;
};

const pathParams = z.looseObject({ path: z.string() });

const displayOptions = z.looseObject({
  displayPrefix: z.string(),
  selector: z.string().optional(),
  reserveCodeUnits: z.number().optional(),
});

const fileParams = z.looseObject({
  path: z.string(),
  options: displayOptions,
});

function requestPath(call: PeerCall): string {
  const parsed = pathParams.safeParse(call.params);

  if (!parsed.success) throw new PeerRefusal('invalid_params');

  return parsed.data.path;
}

function readParams(call: PeerCall): FileRequest {
  const parsed = fileParams.safeParse(call.params);

  if (!parsed.success) throw new PeerRefusal('invalid_params');

  return parsed.data;
}

function statAnswer(guarded: GuardedPath): FsStatResult {
  const result: FsStatResult = { kind: guarded.kind, isLink: guarded.isLink };

  return guarded.kind === 'missing'
    ? result
    : { ...result, realPath: guarded.canonical, size: guarded.size };
}

/**
 * The path a read hands to the filesystem library, with the trailing
 * separator the caller wrote: the library answers a file with one as
 * `not_found` (the daemon's `readTargetPath`).
 */
function readTargetPath(requested: string, guarded: GuardedPath): string {
  return requested.length > 1 && requested.endsWith('/')
    ? `${guarded.path}/`
    : guarded.path;
}

async function readAnswer(
  requested: string,
  guarded: GuardedPath,
  options: NativeDisplayOptions,
): Promise<FsReadResult> {
  const displayPath = `${options.displayPrefix}${guarded.path}`;

  const result = await readResolvedFile(
    readTargetPath(requested, guarded),
    readOptions(options, displayPath, new AbortController().signal),
  );

  return withCanonicalPath(result, guarded, options.displayPrefix);
}

async function listEntries(directory: string): Promise<Array<FsListEntry>> {
  const entries: Array<FsListEntry> = [];

  for await (const entry of await opendir(directory)) {
    entries.push({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? 'link'
        : entry.isDirectory()
          ? 'directory'
          : entry.isFile()
            ? 'file'
            : 'other',
    });
  }

  return entries.sort((left, right) => {
    const leftDirectory = left.kind === 'directory' ? 0 : 1;
    const rightDirectory = right.kind === 'directory' ? 0 : 1;

    return leftDirectory === rightDirectory
      ? left.name.localeCompare(right.name)
      : leftDirectory - rightDirectory;
  });
}

async function listAnswer(guarded: GuardedPath): Promise<FsListResult> {
  if (guarded.kind !== 'directory')
    return failure('not_regular_file', NOT_DIRECTORY_MESSAGE);

  let entries: Array<FsListEntry>;

  try {
    entries = await listEntries(guarded.path);
  } catch {
    return failure('executor_unavailable', LISTING_FAILED_MESSAGE);
  }

  return {
    entries: entries.slice(0, DIRECTORY_TRAVERSAL_BUDGET),
    totalCount: entries.length,
    truncated: entries.length > DIRECTORY_TRAVERSAL_BUDGET,
  };
}

async function writeAnswer(
  guarded: GuardedPath,
  call: PeerCall,
  options: NativeDisplayOptions,
): Promise<FsMutateResult> {
  if (!isRecord(call.params) || !isString(call.params.content))
    throw new PeerRefusal('invalid_params');
  const input = { path: guarded.canonical, content: call.params.content };

  const runtime = {
    displayPath: `${options.displayPrefix}${guarded.path}`,
    reserveCodeUnits: options.reserveCodeUnits,
  };

  if (call.params.replace === true)
    return replaceFile(input, new AbortController().signal, runtime);
  await mkdir(dirname(guarded.canonical), { recursive: true });

  return createFile(input, new AbortController().signal, runtime);
}

function withoutEchoedText(result: EditSuccess | FileFailure): FsMutateResult {
  if (result.status !== 'success') return result;

  return { ...result, display: { startLine: result.display.startLine } };
}

async function editAnswer(
  guarded: GuardedPath,
  call: PeerCall,
  options: NativeDisplayOptions,
): Promise<FsMutateResult> {
  if (
    !isRecord(call.params) ||
    !isString(call.params.oldText) ||
    !isString(call.params.newText)
  )
    throw new PeerRefusal('invalid_params');

  return withoutEchoedText(
    await editFile(
      {
        path: guarded.canonical,
        oldText: call.params.oldText,
        newText: call.params.newText,
      },
      new AbortController().signal,
      {
        displayPath: `${options.displayPrefix}${guarded.path}`,
        reserveCodeUnits: options.reserveCodeUnits,
      },
    ),
  );
}

function mediaTypeOf(bytes: Buffer): string {
  const head = bytes.subarray(0, SIGNATURE_BYTES).toString('latin1');

  if (head.startsWith('\u0089PNG\r\n\u001a\n')) return 'image/png';

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';

  if (head.startsWith('GIF87a') || head.startsWith('GIF89a'))
    return 'image/gif';

  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP')
    return 'image/webp';

  if (head.startsWith('%PDF-')) return 'application/pdf';

  return OCTET_STREAM;
}

function byteNotifications(
  bytes: Buffer,
): ReadonlyArray<{ notification: string; params: JsonValue }> {
  const chunks: Array<{ notification: string; params: JsonValue }> = [];

  for (
    let offset = 0, seq = 1;
    offset < bytes.byteLength;
    offset += BYTES_CHUNK_BYTES, seq += 1
  ) {
    chunks.push({
      notification: BYTES_NOTIFICATION,
      params: {
        seq,
        data: bytes
          .subarray(offset, offset + BYTES_CHUNK_BYTES)
          .toString('base64'),
      },
    });
  }

  return chunks;
}

async function bytesAnswer(guarded: GuardedPath): Promise<PeerAnswer> {
  if (guarded.kind !== 'file')
    return { value: failure('not_regular_file', NOT_REGULAR_FILE) };

  const bound = async () => {
    const head = Buffer.alloc(SIGNATURE_BYTES);

    try {
      const file = await open(guarded.path, 'r');

      try {
        await file.read(head, 0, SIGNATURE_BYTES, 0);
      } finally {
        await file.close();
      }
    } catch {
      return { value: failure('media_too_large', MEDIA_TOO_LARGE_MESSAGE) };
    }

    const mediaType = mediaTypeOf(head);

    return {
      value: failure(
        'media_too_large',
        mediaType.startsWith('image/')
          ? IMAGE_TOO_LARGE_MESSAGE
          : mediaType === 'application/pdf'
            ? PDF_TOO_LARGE_MESSAGE
            : MEDIA_TOO_LARGE_MESSAGE,
      ),
    };
  };

  if ((guarded.size ?? 0) > MEDIA_MAX_BYTES) return bound();

  const bytes = await readFile(guarded.path);

  if (bytes.byteLength > MEDIA_MAX_BYTES) return bound();

  return {
    value: { size: bytes.byteLength, mediaType: mediaTypeOf(bytes) },
    notifications: byteNotifications(bytes),
  };
}

/** One file request as the answer the daemon would send. */
async function fileAnswer(
  resolvePath: (path: string) => Promise<GuardedPath>,
  call: PeerCall,
): Promise<PeerAnswer> {
  const guarded = await resolvePath(requestPath(call));

  if (call.method === FS_STAT_METHOD) return { value: statAnswer(guarded) };

  if (call.method === FS_LIST_METHOD)
    return { value: await listAnswer(guarded) };

  if (call.method === FS_BYTES_METHOD) return bytesAnswer(guarded);
  const request = readParams(call);

  if (call.method === FS_READ_METHOD)
    return { value: await readAnswer(request.path, guarded, request.options) };

  if (call.method === FS_EDIT_METHOD)
    return { value: await editAnswer(guarded, call, request.options) };

  return { value: await writeAnswer(guarded, call, request.options) };
}

function refusalAnswer(error: unknown): PeerAnswer {
  return error instanceof PeerRefusal
    ? { error: error.code }
    : { error: 'internal' };
}

/**
 * The answers this peer gives: the file methods against the real filesystem
 * under the configured roots, and `roots.list` from the same roots.
 */
export function machineFilesAnswer(
  options: MachineFilesPeerOptions = {},
): (call: PeerCall) => PeerAnswer | Promise<PeerAnswer> | undefined {
  const roots = options.roots ?? ['/'];
  const resolvePath = rootGuard(roots);

  return (call) => {
    const custom = options.answer?.(call);

    if (custom !== undefined) return custom;

    if (call.method === ROOTS_LIST_METHOD)
      return { value: { roots: [...roots] } };

    const known = [
      FS_STAT_METHOD,
      FS_LIST_METHOD,
      FS_READ_METHOD,
      FS_EDIT_METHOD,
      FS_WRITE_METHOD,
      FS_BYTES_METHOD,
    ];

    return known.includes(call.method)
      ? fileAnswer(resolvePath, call).catch(refusalAnswer)
      : undefined;
  };
}

/**
 * A connector whose own Machine answers files from the real filesystem, so a
 * tool test keeps exercising real reads and mutations after the host file
 * family moved onto the Machine surface.
 */
export function machineFilesConnector(
  options: MachineFilesPeerOptions = {},
): MachineFilesConnector {
  const name = options.name ?? DEFAULT_NAME;
  const roots = options.roots ?? ['/'];

  const peer = createProtocolPeer({
    roots,
    answer: machineFilesAnswer({ ...options, roots }),
  });

  const connector = new MachineConnector({
    machines: { local: name, default: name, hosts: { [name]: {} } },
    hubVersion: '0.0.0-machine-files-test',
    bindIdentity: () => Promise.resolve('match'),
    localTransportFactory: peer.factory,
  });

  return Object.assign(connector, { peer });
}
