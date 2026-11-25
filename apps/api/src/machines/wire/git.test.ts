import { describe, expect, it, vi } from 'vitest';
import {
  EntryKind,
  GitFailureReason,
  OperationKind,
  SubmoduleMode,
} from '@workspace/machine-protocol';
import type { MachineSession } from '../machine-session';
import { gitHandlers } from './git';

function sessionWith(
  git: Record<string, object>,
  roots = ['/srv'],
  files: Record<string, object> = {},
): MachineSession {
  return {
    name: 'host-a',
    hello: { roots },
    clients: { git, files },
    callOptions: vi.fn(() => ({})),
  } as unknown as MachineSession;
}

const options = { displayPrefix: 'machine://host-a' };
const envelope = { budgetMs: 30_000 };

describe('Git wire handlers', () => {
  it('maps inspect to GetRepository and renders repository paths as locators', async () => {
    const getRepository = vi.fn().mockResolvedValue({
      result: {
        case: 'repository',
        value: {
          worktree: '/srv/repo',
          gitDir: '/srv/repo/.git',
          commonDir: '/srv/repo/.git',
          remotes: [],
          branch: 'main',
          head: 'abc',
        },
      },
    });
    const session = sessionWith({ getRepository });

    const result = await gitHandlers['git.inspect']!(
      session,
      { envelope, path: 'machine://host-a/srv/repo', options },
      {},
    );

    expect(getRepository).toHaveBeenCalledWith({ path: '/srv/repo' }, {});
    expect(result).toMatchObject({
      status: 'ok',
      toplevel: 'machine://host-a/srv/repo',
      commonDir: 'machine://host-a/srv/repo/.git',
      linked: false,
    });
  });

  it('maps locate to LocateRepository and returns the located entry kind', async () => {
    const locateRepository = vi.fn().mockResolvedValue({
      result: { case: 'gitEntry', value: '/srv/repo/.git' },
    });
    const getEntry = vi.fn().mockResolvedValue({
      result: { case: 'entry', value: { kind: EntryKind.DIRECTORY } },
    });
    const session = sessionWith({ locateRepository }, ['/srv'], { getEntry });

    const result = await gitHandlers['git.locate']!(
      session,
      { envelope, path: '/srv/repo/src', options },
      {},
    );

    expect(locateRepository).toHaveBeenCalledWith(
      { path: '/srv/repo/src' },
      {},
    );
    expect(getEntry).toHaveBeenCalledWith({ path: '/srv/repo/.git' }, {});
    expect(result).toEqual({
      status: 'ok',
      gitEntry: 'machine://host-a/srv/repo/.git',
      kind: 'directory',
    });
  });

  it('maps state to entry-bound GetStatus and maps status fields', async () => {
    const locateRepository = vi.fn().mockResolvedValue({
      result: { case: 'gitEntry', value: '/srv/repo/.git' },
    });
    const getStatus = vi.fn().mockResolvedValue({
      result: {
        case: 'status',
        value: {
          repository: {
            worktree: '/srv/repo',
            remotes: [],
            branch: 'main',
            head: 'abc',
          },
          relativePath: 'src',
          upstream: {
            name: 'origin/main',
            gone: false,
            ahead: 1,
            behind: 2,
            updatedAt: { seconds: 1_700_000_000n, nanos: 0 },
          },
          operation: { kind: OperationKind.REBASE, step: 2, total: 4 },
          counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 4 },
          changes: [{ status: ' M', path: 'src/a.ts' }],
          omitted: 0,
          submodules: [],
          commits: [{ id: 'abc', subject: 'change' }],
        },
      },
    });
    const session = sessionWith({ locateRepository, getStatus });

    const result = await gitHandlers['git.state']!(
      session,
      {
        envelope,
        path: '/srv/repo/src',
        gitEntry: 'machine://host-a/srv/repo/.git',
        limit: 8,
        submodules: 'check',
        options,
      },
      {},
    );

    expect(getStatus).toHaveBeenCalledWith(
      {
        path: '/srv/repo/src',
        gitEntry: '/srv/repo/.git',
        maxEntries: 8,
        maxCommits: 10,
        submodules: SubmoduleMode.CHECK,
      },
      {},
    );
    expect(result).toMatchObject({
      status: 'ok',
      toplevel: 'machine://host-a/srv/repo',
      rootRelative: 'src',
      operation: { kind: 'rebase', step: 2, total: 4 },
      upstream: { updatedAt: '2023-11-14T22:13:20.000Z' },
      counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 4 },
    });
  });

  it('rewrites registered root paths in failure stderr, including root /', async () => {
    const getRepository = vi.fn().mockResolvedValue({
      result: {
        case: 'failure',
        value: {
          reason: GitFailureReason.GIT_FAILED,
          message: '',
          stderr: "fatal: bad path '/srv/repo' and '/repo'",
        },
      },
    });
    const session = sessionWith({ getRepository }, ['/srv', '/']);

    const result = await gitHandlers['git.inspect']!(
      session,
      { envelope, path: '/srv/repo', options },
      {},
    );

    expect(result).toEqual({
      status: 'error',
      type: 'git_failed',
      stderr:
        "fatal: bad path 'machine://host-a/srv/repo' and 'machine://host-a/repo'",
    });
  });

  it('maps an option-like base refusal to invalid_input', async () => {
    const createWorktree = vi.fn().mockResolvedValue({
      result: {
        case: 'failure',
        value: {
          reason: GitFailureReason.INVALID_INPUT,
          message: 'base must not start with -',
          stderr: '',
        },
      },
    });
    const result = await gitHandlers['git.worktreeAdd']!(
      sessionWith({ createWorktree }),
      {
        envelope,
        source: '/srv/repo',
        branch: 'feature',
        baseRef: '-option',
        directory: '/srv/worktree',
        options,
      },
      {},
    );

    expect(createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ base: '-option' }),
      {},
    );
    expect(result).toEqual({
      status: 'error',
      type: 'invalid_input',
      message: 'base must not start with -',
    });
  });
});
