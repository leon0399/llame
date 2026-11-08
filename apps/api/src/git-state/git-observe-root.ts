import { ExecutorGitError } from '../machines/executor-git-error';
import { type ExecutorGit } from '../machines/executor-git.service';
import {
  type GitObserveInput,
  type GitSnapshotService,
} from './git-snapshot.service';
import { type GitObservation } from './git-state-view';

export type GitObserveDeps = {
  readonly snapshots: Pick<GitSnapshotService, 'observe'>;
  /** Absent in a worker that serves no git. */
  readonly executors: Pick<ExecutorGit, 'locate'> | undefined;
};

/**
 * The git observation of one bound Workspace root: derive the executor from the
 * root's address, then run the snapshot service. It never rejects, so a caller
 * may start it without awaiting it and a failure is one absence, not a failed
 * Run.
 */
export async function observeWorkspaceRoot(
  deps: GitObserveDeps,
  input: Omit<GitObserveInput, 'target'>,
): Promise<GitObservation> {
  try {
    if (deps.executors === undefined) {
      return { kind: 'unavailable', reason: 'executor_unavailable' };
    }
    return await deps.snapshots.observe({
      ...input,
      target: deps.executors.locate(input.root),
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason:
        error instanceof ExecutorGitError &&
        error.code === 'executor_unavailable'
          ? 'executor_unavailable'
          : 'git_failed',
    };
  }
}
