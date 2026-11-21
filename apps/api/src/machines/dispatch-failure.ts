import {
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  MachineProtocolError,
} from '@workspace/machine-protocol';

import { ExecutorGitError } from './executor-git-error';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
  MachineUpdateRequiredError,
} from './machine-session';

/** A Machine failure as the code the callers answer. */
export function dispatchFailure(
  machine: string,
  method: string,
  error: unknown,
): Error {
  if (error instanceof MachineUpdateRequiredError)
    return new ExecutorGitError('machine_update_required', error.message);

  // Before the unavailable branch: a mismatch extends it and has its own code.
  if (error instanceof MachineIdentityMismatchError)
    return new ExecutorGitError(
      'machine_identity_mismatch',
      `The Machine ${machine} answered with a different identity than the one bound to its name.`,
    );

  if (error instanceof MachineUnavailableError)
    // The session's own message is the transport's: an ssh standard error or
    // a socket failure, which the repository routes would answer as the body
    // of an HTTP response. Only the Machine and the reason leave the hub.
    // Only a mutation can leave an effect behind: `sent` on a read would
    // claim an unknown outcome for a request that wrote nothing.
    return new ExecutorGitError(
      'machine_unavailable',
      `The Machine ${machine} is unavailable (${error.reason}).`,
      error.sent &&
        (method === GIT_WORKTREE_ADD_METHOD ||
          method === GIT_WORKTREE_REMOVE_METHOD),
    );

  if (error instanceof MachineProtocolError) {
    // A path outside the Machine's registered roots is its refusal of the
    // address, not a git failure: registration maps that to 403
    // `permission_denied`, and worktree entry answers it under its own code.
    return error.code === 'path_not_registered'
      ? new ExecutorGitError('path_not_registered', error.message)
      : new ExecutorGitError(
          'git_failed',
          `${method} failed on ${machine}: ${error.message}`,
        );
  }

  return error instanceof Error ? error : new Error(String(error));
}
