import { ExecutorGitError } from '../machines/executor-git-error';
import { observeWorkspaceRoot } from './git-observe-root';
import { type GitObservation } from './git-state-view';

const TARGET = { executorId: 'host-a', machine: undefined, path: '/repo' };
const OBSERVATION: GitObservation = { kind: 'not_a_repository' };
const admit = () => true;

describe('observeWorkspaceRoot', () => {
  it('observes the target the executor derives from the root', async () => {
    const observe = vi.fn().mockResolvedValue(OBSERVATION);
    const reachable = () => Promise.resolve(true);

    const result = await observeWorkspaceRoot(
      { snapshots: { observe }, executors: { locate: () => TARGET } },
      { root: '/repo', admit, reachable },
    );

    expect(result).toBe(OBSERVATION);
    expect(observe).toHaveBeenCalledExactlyOnceWith({
      target: TARGET,
      root: '/repo',
      admit,
      reachable,
    });
  });

  it('is executor unavailable in a worker without git', async () => {
    const observe = vi.fn();

    await expect(
      observeWorkspaceRoot(
        { snapshots: { observe }, executors: undefined },
        { root: '/repo', admit },
      ),
    ).resolves.toEqual({ kind: 'unavailable', reason: 'executor_unavailable' });
    expect(observe).not.toHaveBeenCalled();
  });

  it('maps an unconfigured executor to executor unavailable', async () => {
    const locate = () => {
      throw new ExecutorGitError('executor_unavailable', 'No Machine named x.');
    };

    await expect(
      observeWorkspaceRoot(
        { snapshots: { observe: vi.fn() }, executors: { locate } },
        { root: 'machine://x/srv', admit },
      ),
    ).resolves.toEqual({ kind: 'unavailable', reason: 'executor_unavailable' });
  });

  it.each([new ExecutorGitError('invalid_path', 'bad'), new Error('boom')])(
    'never rejects: %s becomes git failed',
    async (error) => {
      const observe = vi.fn().mockRejectedValue(error);

      await expect(
        observeWorkspaceRoot(
          { snapshots: { observe }, executors: { locate: () => TARGET } },
          { root: '/repo', admit },
        ),
      ).resolves.toEqual({ kind: 'unavailable', reason: 'git_failed' });
    },
  );
});
