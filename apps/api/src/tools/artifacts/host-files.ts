/**
 * Host files for tool-result artifacts (tool-result-artifacts D10).
 *
 * Postgres is the authority; these files are a cache a `bash` call can open
 * with its own host authority. They exist only when the process has a native
 * executor and `bash` is allowlisted, and they are written after the artifact
 * commits, reconciled by size and modification time, and swept after seven
 * days. Any failure here leaves the artifact intact: the next reconcile
 * writes the file again.
 */

import { randomUUID } from 'node:crypto';
import {
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

import { type TenantRunner } from '../../db/tenant-db.service';
import { ArtifactsRepository, type ChatPartFile } from './artifacts-repository';

/** The process's `$TMPDIR` home of every Chat directory on this host. */
const HOST_ROOT = 'llame';

/** A Chat directory unreconciled for this long is removed by the sweep. */
export const SWEEP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** A Chat id is a UUID; the sweep leaves any other directory name alone. */
const UUID_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A part as the writer hands it to the host files. */
export type HostFilePart = {
  readonly name?: string;
  readonly contentType: string;
  readonly content: Buffer;
};

/** The directory holding one artifact's files, when they were written. */
export type WrittenHostFiles = {
  readonly directory: string;
};

/** The trusted fields a reconcile reads; a `bash` call has all of them. */
export type ArtifactHostContext = {
  readonly tenantDb: TenantRunner;
  readonly userId: string;
  readonly chatId: string;
};

/** `$TMPDIR/llame/chats`: the parent of every Chat directory on this host. */
function chatsRoot(): string {
  return join(tmpdir(), HOST_ROOT, 'chats');
}

/** The Chat's artifact directory on the llame host (D10). */
export function artifactDirectory(chatId: string): string {
  return confined(chatsRoot(), join(chatId, 'artifacts'));
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
  readonly parts: ReadonlyArray<HostFilePart>;
}): Promise<WrittenHostFiles | undefined> {
  try {
    const directory = artifactDirectory(input.chatId);
    await mkdir(directory, { recursive: true });
    for (const part of input.parts) {
      const file = partFileName(
        input.toolName,
        input.seq,
        part.name ?? '',
        part.contentType,
      );
      await writeFileAtomically(directory, file, part.content, input.createdAt);
    }
    await touch(confined(chatsRoot(), input.chatId));
    return { directory: filesDirectory(directory, input) };
  } catch {
    return undefined;
  }
}

/**
 * Compare the Chat's files with its stored parts and rewrite each absent file
 * and each file whose size or modification time differs. Content is fetched
 * only for a file that must be written; the directory is touched either way,
 * which marks the Chat as seen for the sweep.
 */
export async function reconcileArtifactFiles(
  context: ArtifactHostContext,
): Promise<void> {
  const parts = await context.tenantDb.runAs(context.userId, (db) =>
    new ArtifactsRepository(db).listChatPartFiles(context.chatId),
  );
  if (parts.length === 0) return;
  const directory = artifactDirectory(context.chatId);
  const stale = await staleParts(directory, parts);
  if (stale.length > 0) await repairParts(context, directory, stale);
  await touch(confined(chatsRoot(), context.chatId));
}

/**
 * Remove each Chat directory on this host that no reconcile touched for seven
 * days (D10). A live Chat gets its files back at its next reconcile.
 */
export async function sweepArtifactDirectories(
  now: Date = new Date(),
): Promise<void> {
  const root = chatsRoot();
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

/** The parts whose host file is absent, another size, or another time. */
async function staleParts(
  directory: string,
  parts: ReadonlyArray<ChatPartFile>,
): Promise<Array<ChatPartFile>> {
  const stale: Array<ChatPartFile> = [];
  for (const part of parts) {
    if (!(await fileMatches(directory, part))) stale.push(part);
  }
  return stale;
}

async function fileMatches(
  directory: string,
  part: ChatPartFile,
): Promise<boolean> {
  const target = confined(
    directory,
    partFileName(part.toolName, part.seq, part.name, part.contentType),
  );
  const stored = await stat(target).catch(() => undefined);
  if (stored === undefined) return false;
  return (
    stored.size === part.byteSize &&
    Math.abs(stored.mtimeMs - part.createdAt.getTime()) < 1
  );
}

/** Fetch the bytes of each stale part, then write them outside the read. */
async function repairParts(
  context: ArtifactHostContext,
  directory: string,
  stale: ReadonlyArray<ChatPartFile>,
): Promise<void> {
  const found = await context.tenantDb.runAs(context.userId, async (db) => {
    const repository = new ArtifactsRepository(db);
    const repaired: Array<{ part: ChatPartFile; content: Buffer }> = [];
    for (const part of stale) {
      const stored = await repository.findPart(part.artifactId, part.name);
      if (stored !== undefined)
        repaired.push({ part, content: stored.content });
    }
    return repaired;
  });
  for (const { part, content } of found) {
    await writeFileAtomically(
      directory,
      partFileName(part.toolName, part.seq, part.name, part.contentType),
      content,
      part.createdAt,
    );
  }
}

/**
 * `<toolName>-<n>.<ext>`, or `<toolName>-<n>/<part>.<ext>` for a named part
 * (D10). Every name comes from the stored locator and part name, which the
 * store admits as one token; the caller still confines the result.
 */
function partFileName(
  toolName: string,
  seq: number,
  name: string,
  contentType: string,
): string {
  const stem = `${toolName}-${seq}`;
  const file = name === '' ? stem : join(stem, name);
  return `${file}${contentExtension(contentType)}`;
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

/** The directory the notice names: a named part lives in its artifact's. */
function filesDirectory(
  directory: string,
  input: {
    readonly toolName: string;
    readonly seq: number;
    readonly parts: ReadonlyArray<HostFilePart>;
  },
): string {
  const named = input.parts.some((part) => (part.name ?? '') !== '');
  return named ? join(directory, `${input.toolName}-${input.seq}`) : directory;
}

/** A temporary name, then a rename, so a `bash` call never reads half a file. */
async function writeFileAtomically(
  directory: string,
  file: string,
  content: Buffer,
  modified: Date,
): Promise<void> {
  const target = confined(directory, file);
  await mkdir(dirname(target), { recursive: true });
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
  await mkdir(directory, { recursive: true });
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
