import { ExecutorGitError } from '../machines/executor-git-error';
import { type ExecutorTarget } from '../machines/executor-git.service';
import { parseMachineLocator } from '../machines/machine-locator';
import { type WorkspaceAuthority } from './workspace-binding';

/**
 * The executor target of one already-canonical worktree source: the local
 * executor keeps the absolute path, and a Machine address decodes to the path
 * its daemon knows. The caller has already decided the canonical address, so
 * this function only refuses an address that names no single Machine path.
 */
export function targetOf(input: {
  readonly authority: WorkspaceAuthority;
  readonly canonical: string;
}): ExecutorTarget {
  const { authority, canonical } = input;
  if (authority.machine === undefined) {
    return {
      executorId: authority.executorId,
      machine: undefined,
      path: canonical,
    };
  }
  const parsed = parseMachineLocator(canonical);
  if (parsed.kind !== 'path') {
    throw new ExecutorGitError(
      'invalid_path',
      'The canonical Machine address does not name one absolute path.',
    );
  }
  return {
    executorId: authority.executorId,
    machine: authority.machine.name,
    path: parsed.path,
  };
}
