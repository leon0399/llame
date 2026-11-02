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
 * verified before every use: a symlinked or foreign-owned `llame/` or `chats/`
 * would let another local user steer the writes and the sweep. When the check
 * fails, no file is written, reconciled, or swept, and one warning is logged.
 */

import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';

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
  'tenantDb' | 'userId' | 'chatId'
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
    if (!(await isPrivateDirectory(parent))) {
      return refuseRoot(`${parent} is not a private directory of this user`);
    }
    await mkdir(root, { recursive: true, mode: PRIVATE_MODE });
  } catch (error) {
    return refuseRoot(`cannot create ${root}: ${String(error)}`);
  }
  return (await isPrivateDirectory(root))
    ? root
    : refuseRoot(`${root} is not a private directory of this user`);
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

function refuseRoot(reason: string): undefined {
  if (!rootWarned) {
    rootWarned = true;
    logger.warn(`Artifact host files disabled: ${reason}`);
  }
  return undefined;
}

/**
 * Write one artifact's parts as host files after its commit. A failed write
 * does not fail the artifact, and `undefined` means no file was written, so no
 * notice names a directory.
 */
export async function writeArtifactHostFiles(input: {
  readonly chatId: string;
  readonly toolName: string;
  readonly seq: number;
  readonly createdAt: Date;
  readonly parts: ReadonlyArray<
    Pick<NewArtifactPart, 'name' | 'contentType' | 'content'>
  >;
}): Promise<string | undefined> {
  const root = await verifiedChatsRoot();
  if (root === undefined) return undefined;
  try {
    const directory = confined(root, join(input.chatId, 'artifacts'));
    await mkdir(directory, { recursive: true, mode: PRIVATE_MODE });
    for (const part of input.parts) {
      await writeFileAtomically(
        directory,
        partFileName({ ...input, ...part }),
        part.content,
        input.createdAt,
      );
    }
    await touch(confined(root, input.chatId));
    return input.parts.every((part) => part.name === '')
      ? directory
      : join(directory, `${input.toolName}-${input.seq}`);
  } catch {
    return undefined;
  }
}

/**
 * Compare the Chat's files with its stored parts and rewrite each absent file
 * and each file whose size or modification time differs. Content is fetched
 * one part at a time, only for a file that must be written; the directory is
 * touched either way, which marks the Chat as seen for the sweep.
 */
export async function reconcileArtifactFiles(
  context: ArtifactHostContext,
): Promise<void> {
  const root = await verifiedChatsRoot();
  if (root === undefined) return;
  const parts = await context.tenantDb.runAs(context.userId, (db) =>
    new ArtifactsRepository(db).listChatPartFiles(context.chatId),
  );
  if (parts.length === 0) return;
  const directory = confined(root, join(context.chatId, 'artifacts'));
  const matches = await Promise.all(
    parts.map((part) => fileMatches(directory, part)),
  );
  for (const [index, part] of parts.entries()) {
    if (!matches[index]) await repairPart(context, directory, part);
  }
  await touch(confined(root, context.chatId));
}

async function fileMatches(
  directory: string,
  part: ChatPartFile,
): Promise<boolean> {
  const target = confined(directory, partFileName(part));
  const stored = await stat(target).catch(() => undefined);
  if (stored === undefined) return false;
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
    const content = await context.tenantDb.runAs(context.userId, (db) =>
      new ArtifactsRepository(db).findPartContent(part.artifactId, part.name),
    );
    if (content === undefined) return;
    await writeFileAtomically(
      directory,
      partFileName(part),
      content,
      part.createdAt,
    );
  } catch {
    // The next reconcile tries this file again.
  }
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
    const modified = await stat(directory).catch(() => undefined);
    if (modified === undefined) continue;
    if (now.getTime() - modified.mtimeMs <= SWEEP_AFTER_MS) continue;
    await rm(directory, { recursive: true, force: true }).catch(
      () => undefined,
    );
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
  const stem = `${part.toolName}-${part.seq}`;
  const file = part.name === '' ? stem : join(stem, part.name);
  return `${file}${contentExtension(part.contentType)}`;
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
  await mkdir(dirname(target), { recursive: true, mode: PRIVATE_MODE });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
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
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error('An artifact path leaves its Chat directory.');
  }
  return target;
}
