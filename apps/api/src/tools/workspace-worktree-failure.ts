/**
 * The executor refusals one worktree call answers (openspec `repositories`,
 * design D5). A Machine link lost after a mutation was sent may have left its
 * effect behind, so it is reported as unknown with the directory that can
 * remain; every read answers its own code, because a read wrote nothing.
 *
 * It sits apart from the entry itself so the entry keeps the ordered decisions
 * and the transaction, and so the tool vocabulary of this surface has one
 * home.
 */

import { ExecutorGitError } from '../machines/executor-git-error';
import { machineIdentityMismatchResult } from './machine-call';
import { type ToolErrorResult } from './types';

/** One worktree call that ended with an observation instead of a binding. */
export type Failed = {
  readonly status: 'failed';
  readonly result: ToolErrorResult;
};

export function executorFailure(
  error: unknown,
  machine: string | undefined,
  leftDirectory?: string,
): Failed {
  if (!(error instanceof ExecutorGitError)) throw error;

  return {
    status: 'failed',
    result: refusalResult(error, machine, leftDirectory),
  };
}

/** The observation one executor refusal answers, in the code this surface owns. */
function refusalResult(
  error: ExecutorGitError,
  machine: string | undefined,
  leftDirectory: string | undefined,
): ToolErrorResult {
  switch (error.code) {
    case 'machine_unavailable':
      return error.sent && leftDirectory !== undefined
        ? {
            status: 'error',
            type: 'outcome_unknown',
            message: `The worktree may exist on the Machine; inspect it before retrying. ${error.message}`,
            leftDirectory,
          }
        : {
            status: 'error',
            type: 'machine_unavailable',
            message: error.message,
          };
    case 'machine_identity_mismatch':
      // A mismatch is a handshake answer, so the Machine is always known; the
      // guard keeps a caller that lost the name from inventing one.
      return machine === undefined
        ? { status: 'error', type: 'worktree_failed', message: error.message }
        : machineIdentityMismatchResult(machine);
    case 'machine_update_required':
    case 'path_not_registered':
    case 'executor_unavailable':
      return { status: 'error', type: error.code, message: error.message };
    default:
      return {
        status: 'error',
        type: 'worktree_failed',
        message: error.message,
      };
  }
}
