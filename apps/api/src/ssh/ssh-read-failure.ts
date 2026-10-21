/**
 * What an `ssh://` operation's streams mean (ssh-locator design D4): the
 * pre-marker classifier both remote reads and remote `bash` use, and the read
 * verdict that combines it with the frames.
 *
 * Before the start marker the hub has seen nothing it asked for, so ssh's own
 * stderr and the exit status decide. Authentication is matched as
 * `Permission denied (` rather than the shared looser pattern: a remote script
 * that prints that phrase is not a credential refusal. A successful exit that
 * ran something else — a forced command, `nologin`, a Windows shell — is a
 * host that cannot run the script, not a connection failure. After the marker
 * the link was established: anything but the end trailer is a lost session,
 * whose reason names the connection rather than guessing at the host.
 */

import {
  type SshOperationFailureReason,
  type SshRunOutcome,
} from './ssh-client';
import { type SshReadFrames } from './ssh-script';

const SSH_HOST_KEY_MISMATCH = /host key verification failed/iu;
const SSH_AUTH_FAILED = /Permission denied \(/u;
const SSH_CONNECT_FAILED =
  /connection refused|connection timed out|connect(?:ion)? to .* closed by|connection closed by (?:remote host|[^\n]* port [0-9]+)|operation timed out|could not resolve hostname|no route to host|network is unreachable|connection reset by peer/iu;
// A banner-exchange failure is a connection failure; the same prefix on a
// `debug` line (a raised LogLevel) is the ordinary handshake.
const SSH_HANDSHAKE_FAILED =
  /^(?!debug\d*:)[^\n]*\b(?:kex_exchange_identification|banner exchange):/imu;
const SSH_MISSING_SHELL = /\bsh\b[^\n]*\bnot found\b/iu;
const WINDOWS_SHELL =
  /is not recognized as an internal or external command|is not recognized as the name of a cmdlet|The system cannot find the (?:file|path) specified/iu;

/** Why the host cannot run an llame script at all. */
export type SshUnsupportedHostCause = 'posix_shell' | 'no_script';

/** What one completed process's streams mean before the marker. */
export type SshPreludeFailure =
  | { readonly kind: 'unavailable'; readonly reason: SshOperationFailureReason }
  | { readonly kind: 'unsupported'; readonly cause: SshUnsupportedHostCause }
  | { readonly kind: 'cancelled' };

/**
 * The failure a process that never printed the start marker reports. A spawn
 * error is the missing client; our own deadline before the marker is a host
 * that never answered; and any other exit that ran no llame script is a host
 * whose account cannot, unless the missing interpreter says which one.
 */
export function classifySshPreludeFailure(
  outcome: SshRunOutcome,
): SshPreludeFailure {
  if (outcome.outcome === 'failed') {
    if (outcome.reason === 'cancelled') return { kind: 'cancelled' };
    return {
      kind: 'unavailable',
      reason:
        outcome.reason === 'client_missing' ? 'client_missing' : 'unreachable',
    };
  }
  const { diagnostic, code } = outcome;
  if (SSH_HOST_KEY_MISMATCH.test(diagnostic))
    return { kind: 'unavailable', reason: 'host_key_mismatch' };
  if (SSH_AUTH_FAILED.test(diagnostic))
    return { kind: 'unavailable', reason: 'auth_failed' };
  if (
    SSH_CONNECT_FAILED.test(diagnostic) ||
    SSH_HANDSHAKE_FAILED.test(diagnostic)
  )
    return { kind: 'unavailable', reason: 'unreachable' };
  if (
    (code === 127 && SSH_MISSING_SHELL.test(diagnostic)) ||
    WINDOWS_SHELL.test(diagnostic)
  )
    return { kind: 'unsupported', cause: 'posix_shell' };
  return { kind: 'unsupported', cause: 'no_script' };
}

/** What a read's process and frames amount to. */
export type SshReadVerdict =
  | { readonly kind: 'complete' }
  | SshPreludeFailure
  | { readonly kind: 'unavailable'; readonly reason: 'session_lost' };

/**
 * A read is complete only with the start marker and the end trailer: the
 * marker alone means the link stopped mid-read, whatever ssh exited with.
 */
export function classifySshReadOutcome(
  outcome: SshRunOutcome,
  frames: SshReadFrames,
): SshReadVerdict {
  if (!frames.started) return classifySshPreludeFailure(outcome);
  if (outcome.outcome === 'failed' && outcome.reason === 'cancelled')
    return { kind: 'cancelled' };
  if (frames.status === undefined)
    return { kind: 'unavailable', reason: 'session_lost' };
  return { kind: 'complete' };
}
