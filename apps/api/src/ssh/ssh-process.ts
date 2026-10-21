/**
 * The process seam every SSH client llame spawns goes through (remote-machines
 * design D1, ssh-locator design D1): the smallest child-process surface a
 * caller needs, the default `ssh` spawn, the bounded stderr head kept for
 * classification and the operator, and the classification of ssh's own refusal
 * messages. Machines wrap it as a framed session; `ssh://` layers a one-shot
 * runner on the same seam.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/** The bounded stderr text a link keeps for classification and the operator. */
export const SSH_DIAGNOSTIC_BYTES = 8192;

/**
 * The smallest child-process surface an ssh client needs, so a test can drive
 * a caller's argv and failure paths without an `ssh` binary.
 */
export type SshProcess = {
  readonly stdout: Readable;
  readonly stdin: Writable;
  readonly stderr: Readable;
  kill(): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: (code: number | null, signal: string | null) => void): void;
};

export type SshSpawn = (
  command: string,
  args: ReadonlyArray<string>,
) => SshProcess;

const SSH_HOST_KEY_MISMATCH = /host key verification failed/iu;
const SSH_AUTH_FAILED = /permission denied/iu;

/** The reasons a link failure can map to before a caller adds its own. */
export type SshLinkFailureReason =
  | 'host_key_mismatch'
  | 'auth_failed'
  | 'unreachable'
  | 'session_lost';

/**
 * The reason a link failure maps to. Once the handshake completed the link was
 * established, so an end after that is a lost session, whatever ssh prints.
 * Before it, ssh's own message decides: only a pinned-key refusal is a host-key
 * mismatch, only a credential refusal is an auth failure, and everything else
 * (an unknown host, a black-holed hop, a missing remote command) is
 * unreachable.
 */
export function classifySshLinkFailure(
  established: boolean,
  diagnostic: string,
): SshLinkFailureReason {
  if (established) return 'session_lost';
  if (SSH_HOST_KEY_MISMATCH.test(diagnostic)) return 'host_key_mismatch';
  if (SSH_AUTH_FAILED.test(diagnostic)) return 'auth_failed';
  return 'unreachable';
}

/** Accumulates stderr to a bound, keeping the head (where ssh states its why). */
export function collectSshDiagnostic(stderr: Readable): () => string {
  let text = '';
  stderr.setEncoding('utf8');
  stderr.on('data', (chunk: string) => {
    if (Buffer.byteLength(text) < SSH_DIAGNOSTIC_BYTES) text += chunk;
  });
  stderr.on('error', () => undefined);
  return () => text;
}

/** The production spawn: one `ssh` child process with piped stdio. */
export const spawnSshProcess: SshSpawn = (command, args) => {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    stdout: child.stdout,
    stdin: child.stdin,
    stderr: child.stderr,
    kill: () => {
      child.kill();
    },
    onError: (handler) => child.on('error', handler),
    onClose: (handler) => child.on('close', handler),
  };
};

/**
 * Kill a whole process group, falling back to the child alone when the group
 * is already gone or the pid was never assigned.
 */
function killProcessGroup(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  try {
    // The group id is the detached child's pid, so this reaches the `sh` and
    // `Match exec` children ssh leaves behind when it is killed alone.
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * The one-shot spawn: the `ssh` child leads its own process group, and `kill`
 * terminates that group. A bounded operation ends by killing its process, and
 * an `ssh` killed alone leaves the commands it spawned (`Match exec`, a
 * ProxyCommand) reparented and running, so a model-chosen destination could
 * accumulate them; Machines keep the shared long-lived spawn instead.
 */
export const spawnOneShotSshProcess: SshSpawn = (command, args) => {
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  return {
    stdout: child.stdout,
    stdin: child.stdin,
    stderr: child.stderr,
    kill: () => killProcessGroup(child),
    onError: (handler) => child.on('error', handler),
    onClose: (handler) => child.on('close', handler),
  };
};
