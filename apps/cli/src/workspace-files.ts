import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CliError } from './errors';

const forbidden = /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|id_rsa|id_ed25519|node_modules)$/i;
const maxFileBytes = 262_144;

export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }

/** Defense in depth for built-in file tools; this is NOT an OS-user sandbox. */
export class WorkspaceFiles {
  readonly root: string;
  constructor(root: string, private readonly excluded: readonly string[]) {
    this.root = realpathSync(root);
    if (!lstatSync(this.root).isDirectory()) throw new CliError('workspace', 'Workspace must be a directory.');
  }

  path(input: string, allowMissing = false): string {
    if (!input || isAbsolute(input) || input.includes('\\') || input.includes('\0') || input.includes(':')) {
      throw new CliError('path_denied', 'Use a relative Workspace path.');
    }
    const parts = input.split('/');
    if (parts.some((part) => part === '..' || forbidden.test(part))) {
      throw new CliError('path_denied', 'Parent traversal and sensitive paths are not allowed.');
    }
    let current = this.root;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part || part === '.') continue;
      current = join(current, part);
      this.checkExcluded(current);
      if (allowMissing && index === parts.length - 1 && !existsSync(current)) continue;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) {
        throw new CliError('path_denied', 'Symlinks, hardlinks and special files are not allowed.');
      }
    }
    this.checkExcluded(current);
    return current;
  }

  private checkExcluded(path: string): void {
    for (const entry of this.excluded) {
      const excluded = resolve(entry);
      if (path === excluded || path.startsWith(excluded + sep)) {
        throw new CliError('path_denied', 'CLI configuration and state are not Workspace resources.');
      }
    }
  }

  read(input: string): { content: string; sha256: string } {
    const path = this.path(input);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > maxFileBytes || stat.nlink !== 1) throw new CliError('file_limit', 'Expected a regular text file no larger than 256 KiB.');
      const bytes = readFileSync(fd);
      if (bytes.byteLength > maxFileBytes || bytes.includes(0)) throw new CliError('file_limit', 'Binary or oversized files are not supported.');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new CliError('binary_file', 'File is not valid UTF-8.'); }
      return { content, sha256: digest(bytes) };
    } finally { closeSync(fd); }
  }

  list(input: string): { entries: { name: string; directory: boolean }[]; truncated: boolean } {
    const path = this.path(input);
    const all = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const entries: { name: string; directory: boolean }[] = [];
    for (const item of all) {
      if (forbidden.test(item.name) || item.isSymbolicLink()) continue;
      try { this.path(relative(this.root, join(path, item.name)).split(sep).join('/')); }
      catch { continue; }
      if (entries.length === 200) return { entries, truncated: true };
      entries.push({ name: item.name, directory: item.isDirectory() });
    }
    return { entries, truncated: false };
  }

  verify(input: string, expected: string): string {
    const path = this.path(input, true);
    const actual = existsSync(path) ? this.read(input).sha256 : 'absent';
    if (actual !== expected) throw new CliError('stale_file', 'File changed, or its expected hash is wrong. Read it again before proposing an edit.');
    return path;
  }

  write(input: string, content: string, expected: string): { sha256: string; bytes: number } {
    if (Buffer.byteLength(content) > maxFileBytes) throw new CliError('file_limit', 'Write exceeds 256 KiB.');
    const path = this.verify(input, expected);
    const oldMode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o644;
    const temporary = join(dirname(path), `.${basename(path)}.llame-${randomUUID()}`);
    const fd = openSync(temporary, 'wx', oldMode);
    try { writeFileSync(fd, content); fsyncSync(fd); }
    finally { closeSync(fd); }
    try {
      this.verify(input, expected);
      renameSync(temporary, path);
      if (process.platform !== 'win32') {
        const directory = openSync(dirname(path), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return { sha256: digest(content), bytes: Buffer.byteLength(content) };
  }
}
