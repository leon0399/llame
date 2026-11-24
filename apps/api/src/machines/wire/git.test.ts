import { describe, expect, it, vi } from 'vitest';
import { GitFailureReason, OperationKind } from '@workspace/machine-protocol';
import type { MachineSession } from '../machine-session';
import { gitHandlers } from './git';

function sessionWith(git: Record<string, ReturnType<typeof vi.fn>>): MachineSession {
  return {
    name: 'host-a',
    hello: { roots: ['/srv'] },
    clients: { git },
    callOptions: vi.fn(() => ({})),
  } as unknown as MachineSession;
}
const options = { displayPrefix: 'machine://host-a' };
const envelope = { budgetMs: 30_000 };

describe('Git wire handlers', () => {
  it('renders repository paths as Machine locators', async () => {
    const getRepository = vi.fn().mockResolvedValue({ result: { case: 'repository', value: { worktree: '/srv/repo', gitDir: '/srv/repo/.git', commonDir: '/srv/repo/.git', remotes: [], branch: 'main', head: 'abc' } } });
    const session = sessionWith({ getRepository });
    const result = await gitHandlers['git.inspect']!(session, { envelope, path: 'machine://host-a/srv/repo', options }, {});
    expect(getRepository).toHaveBeenCalledWith({ path: '/srv/repo' }, {});
    expect(result).toMatchObject({ status: 'ok', toplevel: 'machine://host-a/srv/repo', commonDir: 'machine://host-a/srv/repo/.git', linked: false });
  });

  it('maps status enums and timestamp fields to the legacy Git state', async () => {
    const getStatus = vi.fn().mockResolvedValue({ result: { case: 'status', value: {
      repository: { worktree: '/srv/repo', remotes: [], branch: 'main', head: 'abc' }, relativePath: 'src',
      upstream: { name: 'origin/main', gone: false, ahead: 1, behind: 2, updatedAt: { seconds: 1_700_000_000n, nanos: 0 } },
      operation: { kind: OperationKind.REBASE, step: 2, total: 4 }, counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 4 },
      changes: [{ status: ' M', path: 'src/a.ts' }], omitted: 0, submodules: [], commits: [{ id: 'abc', subject: 'change' }],
    } } });
    const session = sessionWith({ getStatus });
    const result = await gitHandlers['git.state']!(session, { envelope, path: '/srv/repo/src', gitEntry: '/srv/repo/.git', limit: 8, submodules: 'check', options }, {});
    expect(result).toMatchObject({ status: 'ok', toplevel: 'machine://host-a/srv/repo', rootRelative: 'src', operation: { kind: 'rebase', step: 2, total: 4 }, upstream: { updatedAt: '2023-11-14T22:13:20.000Z' }, counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 4 } });
  });

  it('rewrites registered roots in Git failure stderr', async () => {
    const getRepository = vi.fn().mockResolvedValue({ result: { case: 'failure', value: { reason: GitFailureReason.GIT_FAILED, message: '', stderr: "fatal: bad path '/srv/repo'" } } });
    const result = await gitHandlers['git.inspect']!(sessionWith({ getRepository }), { envelope, path: '/srv/repo', options }, {});
    expect(result).toEqual({ status: 'error', type: 'git_failed', stderr: "fatal: bad path 'machine://host-a/srv/repo'" });
  });
});
