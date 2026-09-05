import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readSync, renameSync, linkSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join, resolve, parse, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError } from './errors';

export function privateDirectory(path: string): string {
  const full = resolve(path);
  rejectLinkedParents(full);
  mkdirSync(full, { recursive: true, mode: 0o700 });
  rejectLinkedParents(full);
  const stat = lstatSync(full);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CliError('unsafe_storage', 'State directory must be a real directory, not a symbolic link.');
  }
  assertOwner(stat);
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) {
    throw new CliError('unsafe_permissions', 'Choose a private state directory (0700); llame will not change permissions on an existing directory.');
  }
  return full;
}

function assertOwner(stat: Stats): void {
  if (process.getuid && stat.uid !== process.getuid()) {
    throw new CliError('unsafe_owner', 'Private storage must be owned by the current OS user.');
  }
}

function assertFile(stat: Stats, maxBytes: number): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) {
    throw new CliError('unsafe_storage', 'Expected a bounded, regular private file with one link.');
  }
  assertOwner(stat);
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600) {
    throw new CliError('unsafe_permissions', 'Private file permissions must be 0600. Fix its permissions before continuing.');
  }
}

export function readPrivate(path: string, maxBytes = 1_048_576): string {
  rejectLinkedParents(dirname(path));
  const before = lstatSync(path); assertFile(before, maxBytes);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd); assertFile(opened, maxBytes);
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new CliError('storage_changed', 'Private file changed during open.');
    }
    // Read a bounded buffer, not readFileSync on an attacker-grown file.
    const buffer = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (count === 0) break;
      used += count;
    }
    if (used > maxBytes) throw new CliError('unsafe_storage', 'Private file exceeds its size limit.');
    return buffer.subarray(0, used).toString('utf8');
  } finally { closeSync(fd); }
}

export function writePrivate(path: string, content: string, replace = true): void {
  rejectLinkedParents(dirname(path));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  rejectLinkedParents(dirname(path));
  if (existsSync(path)) {
    if (!replace) throw new CliError('already_exists', 'Refusing to overwrite an existing file.');
    readPrivate(path);
  }
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, content); fsyncSync(fd);
  } catch (error) {
    unlinkSync(temporary); throw error;
  } finally { closeSync(fd); }
  try {
    if (replace) renameSync(temporary, path);
    else linkSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  syncDirectory(dirname(path));
}

/** Serialize read-modify-write commands without resolving secrets into config. */
export function updatePrivate(path: string, update: () => string): void {
  withPrivateLock(path, () => writePrivate(path, update()));
}

/** Serialize cooperating local writers; no network request holds this lock. */
export function withPrivateLock<T>(path: string, operation: () => T): T {
  privateDirectory(dirname(path));
  const lock = `${path}.lock`;
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch { throw new CliError('storage_locked', 'Private storage is locked. Retry after the other writer exits; remove a stale .lock only after checking its process.'); }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid }) + '\n');
    return operation();
  } finally { closeSync(fd); unlinkSync(lock); }
}

function syncDirectory(path: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function rejectLinkedParents(path: string): void {
  const full = resolve(path); let current = parse(full).root;
  for (const part of full.slice(current.length).split(sep)) {
    if (!part) continue;
    current = join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new CliError('unsafe_storage', 'Private storage paths must not traverse symbolic links.');
  }
}
