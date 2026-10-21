import {
  sshUnavailableMessage,
  type SshOperationFailureReason,
} from '../ssh/ssh-client';
import { type SshUnsupportedHostCause } from '../ssh/ssh-read-failure';
import { type ToolResult } from './types';

/** The typed refusal for an SSH connection that could not run or be resolved. */
export function sshUnavailableResult(
  reason: SshOperationFailureReason,
): ToolResult {
  return {
    status: 'error',
    type: 'ssh_unavailable',
    message: sshUnavailableMessage(reason),
  };
}

const UNSUPPORTED_HOST_MESSAGES: Record<SshUnsupportedHostCause, string> = {
  posix_shell:
    'The remote account ran no POSIX sh: an ssh:// locator needs a host whose login shell runs POSIX sh, and a Windows or other non-POSIX shell is not supported.',
  no_script:
    'The remote account ran no llame script: a forced command, nologin, or another command ran instead, so an ssh:// locator needs an ordinary POSIX login shell.',
};

/** The typed refusal for a destination that cannot run an llame script. */
export function sshUnsupportedHostResult(
  cause: SshUnsupportedHostCause,
): ToolResult {
  return {
    status: 'error',
    type: 'ssh_unsupported_host',
    message: UNSUPPORTED_HOST_MESSAGES[cause],
  };
}

/** `ssh://` has no mutation path; no process starts for one. */
export function sshUnsupportedMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'unsupported_operation',
    message:
      'An ssh:// locator supports read and a bash working directory only; edit and write do not change remote files.',
  };
}
