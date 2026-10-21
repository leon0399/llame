import {
  sshUnavailableMessage,
  type SshOperationFailureReason,
} from '../ssh/ssh-client';
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

/** `ssh://` has no mutation path; no process starts for one. */
export function sshUnsupportedMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'unsupported_operation',
    message:
      'An ssh:// locator supports read and a bash working directory only; edit and write do not change remote files.',
  };
}
