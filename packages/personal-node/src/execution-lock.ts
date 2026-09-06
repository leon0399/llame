import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError, errorCode } from "./errors";
import { privateDirectory, readPrivate } from "./private-files";
import { integer, parseJson, record, text } from "./validation";

interface OwnedLock {
  readonly raw: string;
  readonly pid: number;
}

/** Exclusive personal executor. Kernel PID liveness is conservative on reuse. */
export function executionLock(directory: string): () => void {
  privateDirectory(directory);
  const path = join(directory, "executor.lock");
  // No automatic stale-file stealing: two recoverers can race to remove a NEW
  // owner's lock. Explicit recover removes a proven-dead owner under a separate guard.
  const nonce = randomUUID();
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST")
      throw new CliError(
        "executor_busy",
        "A local executor lock exists. After an unclean exit, use recover; live executors are never displaced.",
      );
    throw error;
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
    closeSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      /* Already closed, or never opened past the write failure. */
    }
    try {
      unlinkSync(path);
    } catch {
      /* Best-effort cleanup of the lock we just created. */
    }
    throw error;
  }
  return () => {
    if (
      existsSync(path) &&
      readFileSync(path, "utf8") === JSON.stringify({ pid: process.pid, nonce })
    )
      unlinkSync(path);
  };
}

export function removeDeadLock(directory: string): void {
  privateDirectory(directory);
  const guard = join(directory, "recovery.lock");
  const releaseGuard = acquireRecoveryGuard(guard);
  try {
    reclaimExecutor(join(directory, "executor.lock"));
  } finally {
    releaseGuard();
  }
}

function acquireRecoveryGuard(path: string): () => void {
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  for (;;) {
    try {
      createOwnedLock(path, owner);
      return () => releaseOwnedLock(path, owner);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = readRecoveryOwner(path);
      if (processAlive(existing.pid))
        throw new CliError(
          "recovery_busy",
          "Recovery lock exists; another recovery may be active.",
        );
      if (readPrivate(path, 4096) !== existing.raw) continue;
      removeIfPresent(path);
    }
  }
}

function createOwnedLock(path: string, owner: string): void {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") throw error;
    throw error;
  }
  try {
    writeFileSync(fd, owner);
    fsyncSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      /* Already closed, or never opened past the write failure. */
    }
    try {
      unlinkSync(path);
    } catch {
      /* Best-effort cleanup of the lock we just created. */
    }
    throw error;
  }
  closeSync(fd);
}

function releaseOwnedLock(path: string, owner: string): void {
  if (!existsSync(path)) return;
  if (readPrivate(path, 4096) === owner) unlinkSync(path);
}

function readRecoveryOwner(path: string): OwnedLock {
  const raw = readPrivate(path, 4096);
  try {
    const owner = record(parseJson(raw), "recovery lock");
    text(owner.nonce, "recovery nonce", 100);
    return {
      raw,
      pid: integer(owner.pid, "recovery PID", 1, 2_147_483_647),
    };
  } catch {
    throw new CliError(
      "recovery_busy",
      "Recovery lock has no recoverable owner; inspect it before removing it.",
    );
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    throw new CliError(
      "recovery_busy",
      "Cannot prove that the previous recovery stopped.",
    );
  }
}

function reclaimExecutor(path: string): void {
  if (!existsSync(path)) return;
  const original = readPrivate(path, 4096);
  const owner = record(parseJson(original), "executor lock");
  const pid = integer(owner.pid, "executor PID", 1, 2_147_483_647);
  text(owner.nonce, "executor nonce", 100);
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (errorCode(error) !== "ESRCH")
      throw new CliError(
        "executor_busy",
        "Cannot prove that the previous executor stopped.",
      );
    if (readPrivate(path, 4096) !== original)
      throw new CliError("executor_busy", "Executor ownership changed.");
    unlinkSync(path);
    return;
  }
  throw new CliError(
    "executor_busy",
    "The recorded executor process is still alive.",
  );
}
