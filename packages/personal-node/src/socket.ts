import { existsSync, lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readPrivate, withPrivateLock, writePrivate } from './private-files';
import { CliError, errorCode } from './errors';
import { integer, parseJson, record } from './validation';

export function socketPath(directory: string): string {
  if (process.platform === 'win32') throw new CliError('unix_only', 'Persistent local Nodes currently require Unix sockets. Standalone stdio works without a daemon.');
  const path = join(directory, 'node.sock');
  if (Buffer.byteLength(path) > 100) throw new CliError('socket_path', 'Data directory is too long for a Unix socket. Choose a shorter --data-dir.');
  return path;
}

export function assertPrivateSocket(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isSocket() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 ||
    (process.getuid && stat.uid !== process.getuid())) {
    throw new CliError('unsafe_socket', 'The Node endpoint must be a 0600 Unix socket owned by the current user.');
  }
}

export function claimServer(directory: string): () => void {
  privateDirectory(directory);
  const path = join(directory, 'node-server.json');
  const ownership = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  try { writePrivate(path, ownership, false); }
  catch (error) {
    if (error instanceof CliError && error.code === 'already_exists') throw new CliError('node_busy', 'A Node server ownership record exists. Use node recover only after its process has stopped.');
    throw error;
  }
  return () => { if (existsSync(path) && readPrivate(path, 4096) === ownership) unlinkSync(path); };
}

/** No automatic stale endpoint stealing or deleting a newly started server. */
export function recoverServer(directory: string): void {
  privateDirectory(directory);
  const path = join(directory, 'node-server.json');
  withPrivateLock(path, () => {
    if (!existsSync(path)) {
      if (existsSync(socketPath(directory))) throw new CliError('node_unowned', 'An endpoint exists without an ownership record. Inspect it manually; it was not removed.');
      return;
    }
    const original = readPrivate(path, 4096);
    const owner = record(parseJson(original), 'Node ownership');
    const pid = integer(owner.pid, 'Node PID', 1, 2_147_483_647);
    try { process.kill(pid, 0); }
    catch (error) {
      if (errorCode(error) !== 'ESRCH') throw new CliError('node_busy', 'Cannot prove that the Node process stopped.');
      if (readPrivate(path, 4096) !== original) throw new CliError('node_busy', 'Node ownership changed.');
      const socket = socketPath(directory);
      if (existsSync(socket)) { assertPrivateSocket(socket); unlinkSync(socket); }
      // Release ownership last: a new server cannot acquire it before the old socket is gone.
      unlinkSync(path); return;
    }
    throw new CliError('node_busy', 'The recorded Node process is still alive.');
  });
}
