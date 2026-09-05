import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError, errorCode } from './errors';
import { privateDirectory, readPrivate } from './private-files';
import { integer, parseJson, record, text } from './validation';

/** Exclusive personal executor. Kernel PID liveness is conservative on reuse. */
export function executionLock(directory: string): () => void {
  privateDirectory(directory);
  const path = join(directory, 'executor.lock');
  // No automatic stale-file stealing: two recoverers can race to remove a NEW
  // owner's lock. Explicit recover removes a proven-dead owner under a separate guard.
  const nonce = randomUUID();
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if (errorCode(error) === 'EEXIST') throw new CliError('executor_busy', 'A local executor lock exists. After an unclean exit, use recover; live executors are never displaced.');
    throw error;
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
  closeSync(fd);
  return () => {
    if (existsSync(path) && readFileSync(path, 'utf8') === JSON.stringify({ pid: process.pid, nonce })) unlinkSync(path);
  };
}

export function removeDeadLock(directory: string): void {
  privateDirectory(directory);
  const guard = join(directory, 'recovery.lock');
  let fd: number;
  try { fd = openSync(guard, 'wx', 0o600); }
  catch { throw new CliError('recovery_busy', 'Recovery lock exists; another recovery may be active.'); }
  closeSync(fd);
  try {
    const path = join(directory, 'executor.lock');
    if (!existsSync(path)) return;
    const original = readPrivate(path, 4096);
    const owner = record(parseJson(original), 'executor lock');
    const pid = integer(owner.pid, 'executor PID', 1, 2_147_483_647);
    text(owner.nonce, 'executor nonce', 100);
    try { process.kill(pid, 0); }
    catch (error) {
      if (errorCode(error) !== 'ESRCH') throw new CliError('executor_busy', 'Cannot prove that the previous executor stopped.');
      if (readPrivate(path, 4096) !== original) throw new CliError('executor_busy', 'Executor ownership changed.');
      unlinkSync(path);
      return;
    }
    throw new CliError('executor_busy', 'The recorded executor process is still alive.');
  } finally { unlinkSync(guard); }
}
