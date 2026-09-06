import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CliError, errorCode } from "./errors";
import { readPrivate } from "./private-files";
import { integer, parseJson, record, text } from "./validation";

const forbidden =
  /^(?:\.git|\.env(?:\..*)?|\.envrc(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|id_rsa|id_ed25519|node_modules|.+\.(?:pem|key|p12|pfx)|.+\.llame-write-lock)$/iu;
const maxFileBytes = 262_144;
const writeLockSuffix = ".llame-write-lock";

interface OwnedLock {
  readonly raw: string;
  readonly pid: number;
}

export interface FileContents {
  readonly content: string;
  readonly sha256: string;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly directory: boolean;
}

export interface DirectoryListing {
  readonly entries: Array<DirectoryEntry>;
  readonly truncated: boolean;
}

export interface FileWriteResult {
  readonly sha256: string;
  readonly bytes: number;
}

export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Defense in depth for built-in file tools; this is NOT an OS-user sandbox. */
export class WorkspaceFiles {
  readonly root: string;
  constructor(
    root: string,
    private readonly excluded: ReadonlyArray<string>,
  ) {
    this.root = realpathSync(root);
    if (!lstatSync(this.root).isDirectory())
      throw new CliError("workspace", "Workspace must be a directory.");
  }

  path(input: string, allowMissing = false): string {
    if (
      !input ||
      isAbsolute(input) ||
      input.includes("\\") ||
      input.includes("\0") ||
      input.includes(":")
    ) {
      throw new CliError("path_denied", "Use a relative Workspace path.");
    }
    const parts = input.split("/");
    if (parts.some((part) => part === ".." || forbidden.test(part))) {
      throw new CliError(
        "path_denied",
        "Parent traversal and sensitive paths are not allowed.",
      );
    }
    let current = this.root;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part || part === ".") continue;
      current = join(current, part);
      this.checkExcluded(current);
      if (allowMissing && index === parts.length - 1 && !existsSync(current))
        continue;
      const stat = lstatSync(current);
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
      ) {
        throw new CliError(
          "path_denied",
          "Symlinks, hardlinks and special files are not allowed.",
        );
      }
    }
    this.checkExcluded(current);
    return current;
  }

  private checkExcluded(path: string): void {
    for (const entry of this.excluded) {
      const excluded = resolve(entry);
      if (path === excluded || path.startsWith(excluded + sep)) {
        throw new CliError(
          "path_denied",
          "CLI configuration and state are not Workspace resources.",
        );
      }
    }
  }

  read(input: string): FileContents {
    const path = this.path(input);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > maxFileBytes || stat.nlink !== 1)
        throw new CliError(
          "file_limit",
          "Expected a regular text file no larger than 256 KiB.",
        );
      const bytes = readFileSync(fd);
      if (bytes.byteLength > maxFileBytes || bytes.includes(0))
        throw new CliError(
          "file_limit",
          "Binary or oversized files are not supported.",
        );
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new CliError("binary_file", "File is not valid UTF-8.");
      }
      return { content, sha256: digest(bytes) };
    } finally {
      closeSync(fd);
    }
  }

  list(input: string): DirectoryListing {
    const path = this.path(input);
    const all = readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const entries: Array<DirectoryEntry> = [];
    for (const item of all) {
      if (forbidden.test(item.name) || item.isSymbolicLink()) continue;
      try {
        this.path(
          relative(this.root, join(path, item.name)).split(sep).join("/"),
        );
      } catch {
        continue;
      }
      if (entries.length === 200) return { entries, truncated: true };
      entries.push({ name: item.name, directory: item.isDirectory() });
    }
    return { entries, truncated: false };
  }

  verify(input: string, expected: string): string {
    const path = this.path(input, true);
    const actual = existsSync(path) ? this.read(input).sha256 : "absent";
    if (actual !== expected)
      throw new CliError(
        "stale_file",
        "File changed, or its expected hash is wrong. Read it again before proposing an edit.",
      );
    return path;
  }

  write(input: string, content: string, expected: string): FileWriteResult {
    if (Buffer.byteLength(content) > maxFileBytes)
      throw new CliError("file_limit", "Write exceeds 256 KiB.");
    const path = this.path(input, true);
    const release = acquireWriteLock(path);
    try {
      const verifiedPath = this.verify(input, expected);
      const oldMode = existsSync(verifiedPath)
        ? lstatSync(verifiedPath).mode & 0o777
        : 0o644;
      const temporary = createTemporary(verifiedPath, content, oldMode);
      try {
        this.verify(input, expected);
        renameSync(temporary, verifiedPath);
        syncDirectory(dirname(verifiedPath));
      } finally {
        removeTemporary(temporary);
      }
    } finally {
      release();
    }
    return { sha256: digest(content), bytes: Buffer.byteLength(content) };
  }
}

function createTemporary(path: string, content: string, mode: number): string {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.llame-${randomUUID()}`,
  );
  const fd = openSync(temporary, "wx", mode);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return temporary;
}

function removeTemporary(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function acquireWriteLock(path: string): () => void {
  const lock = path + writeLockSuffix;
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  try {
    const fd = openSync(lock, "wx", 0o600);
    try {
      writeFileSync(fd, owner);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return () => releaseWriteLock(lock, owner);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const existing = readWriteLock(lock);
  if (processAlive(existing.pid))
    throw new CliError(
      "stale_file",
      "File is being edited. Read it again before proposing an edit.",
    );
  if (readPrivate(lock) !== existing.raw) {
    return acquireWriteLock(path);
  }
  try {
    unlinkSync(lock);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return acquireWriteLock(path);
}

function releaseWriteLock(path: string, owner: string): void {
  if (existsSync(path) && readPrivate(path) === owner) unlinkSync(path);
}

function readWriteLock(path: string): OwnedLock {
  const raw = readPrivate(path);
  try {
    const owner = record(parseJson(raw), "Workspace write lock");
    text(owner.nonce, "Workspace write nonce", 100);
    return {
      raw,
      pid: integer(owner.pid, "Workspace write PID", 1, 2_147_483_647),
    };
  } catch {
    throw new CliError(
      "stale_file",
      "File has an unrecoverable write lock. Inspect it before continuing.",
    );
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    throw new CliError(
      "stale_file",
      "Cannot prove that another Workspace writer stopped.",
    );
  }
}
