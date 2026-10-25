import { type CreationWorkspaceResult } from './chat-creation-workspace';
import { type CreationLease } from './chat-creation-admission';

/*
 * The Workspace outcomes a resend reaches without running the step again
 * (openspec `chat-start-location`, "Creation runs its steps in one fixed
 * order" and "A resend reads the recorded worktree directory").
 */

/** The binding a stored Chat already holds, which a resend never changes. */
export function storedBinding(
  root: string,
  executorId: string | null,
  lease: CreationLease | null,
): CreationWorkspaceResult {
  return {
    status: 'bound',
    root,
    ...(executorId !== null && { executorId }),
    ...(lease !== null &&
      lease.checkout.path === root && { worktree: worktreeOf(lease) }),
  };
}

/** The worktree a bound root names, as the response reports it. */
export function worktreeOf(lease: CreationLease) {
  return {
    path: lease.checkout.path,
    branch: lease.checkout.branch ?? lease.lease.baseRef,
    baseCommit: lease.lease.baseCommit,
  };
}

/**
 * A resend whose earlier attempt added a worktree that never committed: the
 * directory is left in place, and only the owner can remove it.
 */
export function recordedWorktreeUnknown(
  directory: string,
): CreationWorkspaceResult {
  return {
    status: 'outcome_unknown',
    message:
      'An earlier attempt added a worktree and did not record it; its directory is left in place.',
    leftDirectory: directory,
  };
}
