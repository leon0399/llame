/**
 * Host files for tool-result artifacts (tool-result-artifacts D10).
 *
 * Postgres is the authority; these files are a cache a `bash` call can open
 * with its own host authority. They exist only when the process has a native
 * executor and `bash` is allowlisted, and they are written after the artifact
 * commits, reconciled by size and modification time, and swept after seven
 * days. Any failure here leaves the artifact intact: the next reconcile
 * writes the file again.
 *
 * `$TMPDIR` is shared, so the root is created private to this worker and
 * verified before every use: a symlinked or foreign-owned `llame/`, `chats/`,
 * Chat, or artifact directory would let another local user steer the writes
 * and the sweep. When a check fails, no file is written, reconciled, or
 * swept, and one warning is logged without the path.
 */

import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';

import { isString } from '@workspace/runtime-safety';

import { type ToolContext } from '../types';
import {
  ArtifactsRepository,
  type ChatPartFile,
  type NewArtifactPart,
} from './artifacts-repository';

/** A Chat directory unreconciled for this long is removed by the sweep. */
export const SWEEP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** A Chat id is a UUID; the sweep leaves any other directory name alone. */
const UUID_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A directory only this worker may use. */
const PRIVATE_MODE = 0o700;

const logger = new Logger('ArtifactHostFiles');

/** Whether the unsafe-root warning was already logged in this process. */
let rootWarned = false;

/** The trusted fields a reconcile reads; a `bash` call has all of them. */
export type ArtifactHostContext = Pick<
  ToolContext,
  | 'tenantDb'
  | 'userId'
  | 'chatId'
  | 'abortSignal'
  | 'timeoutSignal'
  | 'moveSignal'
>;

/** Whether this process keeps artifact host files (D10). */
export function hostFilesEnabled(tools: {
  readonly allowed: ReadonlyArray<string>;
  readonly nativeExecutorId?: string | undefined;
}): boolean {
  return tools.allowed.includes('bash') && tools.nativeExecutorId !== undefined;
}

/** The Chat's artifact directory on the llame host (D10). */
export function artifactDirectory(chatId: string): string {
  return confined(chatsRoot(), join(chatId, 'artifacts'));
}

/** `$TMPDIR/llame/chats`: the parent of every Chat directory on this host. */
function chatsRoot(): string {
  return join(tmpdir(), 'llame', 'chats');
}

/**
 * The host root, created and verified private to this worker. `undefined`
 * means host files are refused for this process.
 */
async function verifiedChatsRoot(): Promise<string | undefined> {
  const parent = join(tmpdir(), 'llame');
  const root = chatsRoot();

  try {
    await mkdir(parent, { recursive: true, mode: PRIVATE_MODE });

    // Check the parent before creating anything below it: `mkdir` follows a
    // symlinked component, so a hostile `llame/` would otherwise get a
    // `chats/` child of its target.
    if (!(await isPrivateDirectory(parent))) return refuseRoot();
    await mkdir(root, { recursive: true, mode: PRIVATE_MODE });
  } catch {
    return refuseRoot();
  }

  if (!(await isPrivateDirectory(root))) return refuseRoot();
  // A later unsafe root is a new condition, so it logs again.
  rootWarned = false;

  return root;
}

/**
 * Create a directory below the verified root and require it to be a real
 * directory this user owns: a `bash` command can replace it with a symlink,
 * and the writes must never follow that link out of the Chat tree.
 */
async function privateDirectory(path: string): Promise<boolean> {
  await mkdir(path, { recursive: true, mode: PRIVATE_MODE });

  return await isPrivateDirectory(path);
}

/** A real directory this user owns, with no group or other access. */
async function isPrivateDirectory(path: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => undefined);

  return (
    stats !== undefined &&
    stats.isDirectory() &&
    stats.uid === process.getuid?.() &&
    (stats.mode & 0o077) === 0
  );
}

function refuseRoot(): undefined {
  if (rootWarned) return undefined;
  rootWarned = true;
  logger.warn('Artifact host files disabled: the host root is not private');

  return undefined;
}

/** Whether the Run or the call deadline has already fired. */
function aborted(input: {
  readonly abortSignal?: AbortSignal | undefined;
  readonly timeoutSignal?: AbortSignal | undefined;
}): boolean {
  return (
    input.abortSignal?.aborted === true || input.timeoutSignal?.aborted === true
  );
}

/**
 * Write one artifact's parts as host files after its commit. A failed or
 * aborted write leaves no file and does not fail the artifact; `undefined`
 * means no file was written, so no notice names a directory.
 */
export async function writeArtifactHostFiles(
  input: HostFileWrite,
): Promise<string | undefined> {
  const root = await verifiedChatsRoot();

  if (root === undefined || aborted(input)) return undefined;

  try {
    const chatDirectory = confined(root, input.chatId);
    const directory = confined(root, join(input.chatId, 'artifacts'));

    if (
      !(await privateDirectory(chatDirectory)) ||
      !(await privateDirectory(directory))
    ) {
      return undefined;
    }

    const written = await writeParts(input, directory);

    // A write that lands after the abort names no file, so it must not stay.
    if (aborted(input)) return await discard(directory, written);
    await touch(chatDirectory);

    // Every part is written unless the write aborted above, so the first
    // file's directory is the artifact's own.
    return dirname(join(directory, written[0]));
  } catch (error) {
    logger.warn(`Artifact host file write failed: ${errorCode(error)}`);

    return undefined;
  }
}

/** One artifact's host-file write, as the writer hands it over. */
type HostFileWrite = {
  readonly chatId: string;
  readonly toolName: string;
  readonly seq: number;
  readonly createdAt: Date;
  readonly parts: ReadonlyArray<
    Pick<NewArtifactPart, 'name' | 'contentType' | 'content'>
  >;
  readonly abortSignal?: AbortSignal | undefined;
  readonly timeoutSignal?: AbortSignal | undefined;
};

/** Write each part, stopping between parts once the Run or call aborts. */
async function writeParts(
  input: HostFileWrite,
  directory: string,
): Promise<Array<string>> {
  const written: Array<string> = [];

  for (const part of input.parts) {
    if (aborted(input)) break;
    const file = partFileName({ ...input, ...part });
    await writeFileAtomically(directory, file, part.content, input.createdAt);
    written.push(file);
  }

  return written;
}

/** Remove the files this call wrote, so an aborted write leaves no file. */
async function discard(
  directory: string,
  files: ReadonlyArray<string>,
): Promise<undefined> {
  for (const file of files) {
    await unlink(confined(directory, file)).catch(() => undefined);
  }

  return undefined;
}

/** A filesystem error's code, for a log line that never names a path. */
function errorCode(error: unknown): string {
  if (!(error instanceof Error) || !('code' in error) || !isString(error.code))
    return 'unknown';

  return error.code;
}

/**
 * Compare the Chat's files with its stored parts and rewrite each absent file
 * and each file whose size or modification time differs. Content is fetched
 * one part at a time, only for a file that must be written; the directory is
 * touched either way, which marks the Chat as seen for the sweep. An aborted
 * Run or an expired call stops the pass between parts.
 */
export async function reconcileArtifactFiles(
  context: ArtifactHostContext,
): Promise<void> {
  if (aborted(context) || context.moveSignal?.aborted) return;
  const root = await verifiedChatsRoot();

  if (root === undefined) return;
  const chatDirectory = confined(root, context.chatId);
  const directory = confined(root, join(context.chatId, 'artifacts'));

  if (
    !(await privateDirectory(chatDirectory)) ||
    !(await privateDirectory(directory))
  ) {
    return;
  }

  const parts = await context.tenantDb.runAs(context.userId, (db) =>
    new ArtifactsRepository(db).listChatPartFiles(context.chatId),
  );

  const matches = await Promise.all(
    parts.map((part) => fileMatches(directory, part)),
  );

  for (const [index, part] of parts.entries()) {
    if (aborted(context) || context.moveSignal?.aborted) return;

    if (!matches[index]) await repairPart(context, directory, part);
  }

  await touch(chatDirectory);
}

async function fileMatches(
  directory: string,
  part: ChatPartFile,
): Promise<boolean> {
  const target = confined(directory, partFileName(part));
  // A symlink or a directory at the file's place never counts as current.
  const stored = await lstat(target).catch(() => undefined);

  if (stored === undefined || !stored.isFile()) return false;

  return (
    stored.size === part.byteSize &&
    Math.abs(stored.mtimeMs - part.createdAt.getTime()) < 1
  );
}

/**
 * Fetch and write one stale part. A part that cannot be read or written does
 * not stop the others, and the caller still marks the Chat as seen.
 */
async function repairPart(
  context: ArtifactHostContext,
  directory: string,
  part: ChatPartFile,
): Promise<void> {
  try {
    const [row] = await context.tenantDb.runAs(context.userId, (db) =>
      new ArtifactsRepository(db).findPartContent(
        context.chatId,
        part.artifactId,
        part.name,
      ),
    );

    if (row === undefined) return;
    await writeFileAtomically(
      directory,
      partFileName(part),
      row.content,
      part.createdAt,
    );
  } catch (error) {
    logger.warn(`Artifact host file repair failed: ${errorCode(error)}`);
  }
}

/** Sweep only when this process keeps host files (D10); never rejects. */
export async function sweepWhenHostFilesEnabled(tools: {
  readonly allowed: ReadonlyArray<string>;
  readonly nativeExecutorId?: string | undefined;
}): Promise<void> {
  if (!hostFilesEnabled(tools)) return;
  await sweepArtifactDirectories();
}

/**
 * Remove each Chat directory on this host that no reconcile touched for seven
 * days (D10). A live Chat gets its files back at its next reconcile.
 */
export async function sweepArtifactDirectories(
  now: Date = new Date(),
): Promise<void> {
  const root = await verifiedChatsRoot();

  if (root === undefined) return;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_NAME.test(entry.name)) continue;
    const directory = join(root, entry.name);
    const modified = await lstat(directory).catch(() => undefined);

    if (modified === undefined || !modified.isDirectory()) continue;

    if (now.getTime() - modified.mtimeMs <= SWEEP_AFTER_MS) continue;
    await rm(directory, { recursive: true }).catch(() => undefined);
  }
}

/**
 * `<toolName>-<n>.<ext>`, or `<toolName>-<n>/<part>.<ext>` for a named part
 * (D10). Every name comes from the stored locator and part name, which the
 * store admits as one token; the caller still confines the result.
 */
function partFileName(
  part: Pick<ChatPartFile, 'toolName' | 'seq' | 'name' | 'contentType'>,
): string {
  // `join` drops an empty segment, so an unnamed part is one file in place.
  return `${join(`${part.toolName}-${part.seq}`, part.name)}${contentExtension(part.contentType)}`;
}

/** The extension a content type gives the file, so readers apply. */
function contentExtension(contentType: string): string {
  switch (contentType) {
    case 'text/markdown':
      return '.md';
    case 'application/json':
      return '.json';
    default:
      return '.txt';
  }
}

/** A temporary name, then a rename, so a `bash` call never reads half a file. */
async function writeFileAtomically(
  directory: string,
  file: string,
  content: Buffer,
  modified: Date,
): Promise<void> {
  const target = confined(directory, file);
  const temporary = `${target}.${randomUUID()}.tmp`;

  try {
    if (!(await privateDirectory(dirname(target))))
      throw new Error('The artifact directory is not private.');
    await writeFile(temporary, content, { mode: 0o600 });
    await utimes(temporary, modified, modified);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Mark a directory as seen now; the sweep ages this time. */
async function touch(directory: string): Promise<void> {
  const now = new Date();
  await mkdir(directory, { recursive: true, mode: PRIVATE_MODE });
  await utimes(directory, now, now);
}

/** A path under `root`, or a throw when a name would leave it. */
function confined(root: string, relative: string): string {
  const target = resolve(root, relative);
  const base = resolve(root);

  if (!target.startsWith(`${base}${sep}`)) {
    throw new Error('An artifact path leaves its Chat directory.');
  }

  return target;
}
