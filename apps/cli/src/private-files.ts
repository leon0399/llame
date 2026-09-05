import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, linkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, parse, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError } from './errors';

export function privateDirectory(path: string): string {
  const full = resolve(path);
  mkdirSync(full, { recursive: true, mode: 0o700 });
  rejectLinkedParents(full);
  const stat = lstatSync(full);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CliError('unsafe_storage', 'State directory must be a real directory, not a symbolic link.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077)) {
    throw new CliError('unsafe_permissions', 'Choose a private state directory (0700); llame will not change permissions on an existing directory.');
  }
  return full;
}

export function readPrivate(path: string, maxBytes = 1_048_576): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) {
    throw new CliError('unsafe_storage', 'Expected a bounded, regular private file with one link.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077)) {
    throw new CliError('unsafe_permissions', 'Private file permissions must be 0600. Fix its permissions before continuing.');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return readFileSync(fd, 'utf8'); }
  finally { closeSync(fd); }
}

export function writePrivate(path: string, content: string, replace = true): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  rejectLinkedParents(dirname(path));
  if (existsSync(path)) {
    if (!replace) throw new CliError('already_exists', 'Refusing to overwrite an existing file.');
    readPrivate(path);
  }
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); }
  finally { closeSync(fd); }
  try {
    if (replace) renameSync(temporary, path);
    else linkSync(temporary, path); // Atomic no-clobber publication, unlike a pre-check + rename.
  }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

function rejectLinkedParents(path: string): void {
  const full = resolve(path); let current = parse(full).root;
  for (const part of full.slice(current.length).split(sep)) {
    if (!part) continue;
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new CliError('unsafe_storage', 'Private storage paths must not traverse symbolic links.');
  }
}
