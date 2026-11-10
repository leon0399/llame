import {
  readGitInspectResult,
  readGitLocateResult,
  readGitStateResult,
  readGitWorktreeAddResult,
  readGitWorktreeListResult,
  readGitWorktreeRemoveResult,
} from './git-results';

const MACHINE = 'devl';

describe('a typed git refusal', () => {
  it('passes each refusal type through a reader unchanged', () => {
    expect(
      readGitWorktreeRemoveResult({
        status: 'error',
        type: 'invalid_input',
        message: 'A git path must be absolute.',
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_input',
      message: 'A git path must be absolute.',
    });

    for (const type of ['not_a_repository', 'timed_out', 'git_failed']) {
      expect(
        readGitWorktreeRemoveResult({
          status: 'error',
          type,
          stderr: 'fatal: no repository',
        }),
      ).toEqual({ status: 'error', type, stderr: 'fatal: no repository' });
    }
  });

  it.each([
    [{}],
    [{ status: 'error' }],
    [{ status: 'error', type: 'nope', stderr: 'x' }],
    [{ status: 'error', type: 'git_failed' }],
    [{ status: 'error', type: 'invalid_input', message: 7 }],
  ])('refuses %j', (value) => {
    expect(readGitWorktreeRemoveResult(value)).toBeUndefined();
  });
});

describe('readGitInspectResult', () => {
  const INSPECTED = {
    status: 'ok',
    toplevel: 'machine://devl/srv/app',
    commonDir: 'machine://devl/srv/app/.git',
    linked: false,
    mainWorktree: null,
    remotes: [{ name: 'origin', url: 'github.com/leon0399/llame' }],
    branch: 'main',
    head: '0'.repeat(40),
  };

  it('accepts the locator answer and copies its remotes', () => {
    expect(readGitInspectResult(INSPECTED, MACHINE)).toEqual(INSPECTED);
  });

  it('accepts a linked worktree with a null branch', () => {
    expect(
      readGitInspectResult(
        {
          ...INSPECTED,
          linked: true,
          mainWorktree: 'machine://devl/srv/app',
          branch: null,
        },
        MACHINE,
      ),
    ).toMatchObject({ linked: true, branch: null });
  });

  it('re-encodes the reserved characters the daemon sent raw', () => {
    expect(
      readGitInspectResult(
        {
          ...INSPECTED,
          toplevel: 'machine://devl/srv/a#b/100%',
          commonDir: 'machine://devl/srv/a#b/100%/.git',
          mainWorktree: 'machine://devl/srv/a#b/100%',
        },
        MACHINE,
      ),
    ).toMatchObject({
      toplevel: 'machine://devl/srv/a%23b/100%25',
      commonDir: 'machine://devl/srv/a%23b/100%25/.git',
      mainWorktree: 'machine://devl/srv/a%23b/100%25',
    });
  });

  it.each([
    ['another Machine', 'machine://other/srv/app'],
    ['a local host path', '/srv/app'],
    ['a bare prefix', 'machine://devl'],
    ['a prefix that continues the name', 'machine://devlx/srv/app'],
  ])('refuses a toplevel that is %s', (_case, toplevel) => {
    expect(
      readGitInspectResult({ ...INSPECTED, toplevel }, MACHINE),
    ).toBeUndefined();
  });

  it('reads an absent nullable field as null', () => {
    const { mainWorktree, branch, head, ...absent } = INSPECTED;
    expect(mainWorktree).toBeNull();
    expect(branch).toBe('main');
    expect(head).toBe('0'.repeat(40));
    expect(readGitInspectResult(absent, MACHINE)).toMatchObject({
      mainWorktree: null,
      branch: null,
      head: null,
    });
  });

  it('returns a typed failure unchanged', () => {
    const failure = { status: 'error', type: 'timed_out', stderr: '' };
    expect(readGitInspectResult(failure, MACHINE)).toEqual(failure);
  });

  it.each([
    ['a missing toplevel', { ...INSPECTED, toplevel: undefined }],
    ['a link flag that is not a boolean', { ...INSPECTED, linked: 'no' }],
    ['a remote that is not a record', { ...INSPECTED, remotes: [7] }],
    ['a remote without a url', { ...INSPECTED, remotes: [{ name: 'origin' }] }],
    [
      'a remote with a numeric name',
      { ...INSPECTED, remotes: [{ name: 7, url: 'x' }] },
    ],
    ['a branch that is not text or null', { ...INSPECTED, branch: 7 }],
    ['an unknown status', { ...INSPECTED, status: 'done' }],
  ])('refuses %s', (_case, value) => {
    expect(readGitInspectResult(value, MACHINE)).toBeUndefined();
  });
});

describe('readGitLocateResult', () => {
  it('accepts the entry as a locator and every failure type', () => {
    expect(
      readGitLocateResult(
        {
          status: 'ok',
          gitEntry: 'machine://devl/srv/app/.git',
          kind: 'directory',
        },
        MACHINE,
      ),
    ).toEqual({
      status: 'ok',
      gitEntry: 'machine://devl/srv/app/.git',
      kind: 'directory',
    });

    for (const type of [
      'no_repository_in_root',
      'root_missing',
      'git_entry_changed',
      'outside_registered_root',
      'output_bound',
    ]) {
      const failure = { status: 'error', type, stderr: '' };
      expect(readGitLocateResult(failure, MACHINE)).toEqual(failure);
    }
  });

  it.each([
    ['a gitEntry that is not a locator', { gitEntry: '/srv/app/.git' }],
    ['a locator of another Machine', { gitEntry: 'machine://other/a/.git' }],
    ['an unknown kind', { kind: 'link' }],
    ['an unknown status', { status: 'done' }],
  ])('refuses %s', (_case, override) => {
    expect(
      readGitLocateResult(
        {
          status: 'ok',
          gitEntry: 'machine://devl/srv/app/.git',
          kind: 'file',
          ...override,
        },
        MACHINE,
      ),
    ).toBeUndefined();
  });
});

const STATE = {
  status: 'ok',
  toplevel: 'machine://devl/srv/app',
  rootRelative: 'src',
  branch: 'main',
  detached: false,
  head: 'a'.repeat(40),
  upstream: {
    name: 'origin/main',
    gone: false,
    ahead: 1,
    behind: 0,
    updatedAt: '2026-11-08T10:00:00Z',
  },
  operation: { kind: 'rebase', step: 1, total: 3 },
  counts: { staged: 1, unstaged: 2, untracked: 3, conflicted: 0 },
  entries: [
    { xy: 'M ', path: 'a.ts' },
    { xy: 'R ', path: 'b.ts', from: 'c.ts' },
  ],
  omitted: 4,
  submodules: ['vendor/x'],
  commits: [{ short: 'abc1234', subject: 'add a' }],
  remotes: [{ name: 'origin', url: 'https://example.test/a.git' }],
};

describe('readGitStateResult', () => {
  it('rebuilds a full answer, with the toplevel as a locator', () => {
    expect(readGitStateResult(STATE, MACHINE)).toEqual(STATE);
  });

  it('accepts the null forms of an unborn, detached, idle branch', () => {
    const quiet = {
      ...STATE,
      branch: null,
      detached: true,
      head: null,
      upstream: null,
      operation: null,
      entries: [],
      omitted: 0,
      submodules: [],
      commits: [],
      remotes: [],
    };

    expect(readGitStateResult(quiet, MACHINE)).toEqual(quiet);
  });

  it('accepts a gone upstream with unknown counts', () => {
    const gone = {
      ...STATE,
      upstream: {
        name: 'origin/old',
        gone: true,
        ahead: null,
        behind: null,
        updatedAt: null,
      },
    };

    expect(readGitStateResult(gone, MACHINE)).toEqual(gone);
  });

  it('drops a field the protocol does not declare', () => {
    expect(
      readGitStateResult({ ...STATE, secret: '/home/leo' }, MACHINE),
    ).toEqual(STATE);
  });

  it('returns a typed failure unchanged', () => {
    const failure = { status: 'error', type: 'git_entry_changed', stderr: '' };
    expect(readGitStateResult(failure, MACHINE)).toEqual(failure);
  });

  it.each([
    ['a toplevel that is not a locator', { toplevel: '/srv/app' }],
    ['a rootRelative that is not text', { rootRelative: 1 }],
    ['a detached flag that is not a boolean', { detached: 'no' }],
    ['a head that is not text', { head: 7 }],
    ['an upstream that is not an object', { upstream: 'origin/main' }],
    [
      'an upstream whose gone flag is missing',
      { upstream: { ...STATE.upstream, gone: undefined } },
    ],
    [
      'an upstream with a negative ahead',
      { upstream: { ...STATE.upstream, ahead: -1 } },
    ],
    [
      'an upstream whose updatedAt is not text',
      { upstream: { ...STATE.upstream, updatedAt: 5 } },
    ],
    ['an unknown operation kind', { operation: { kind: 'stash' } }],
    [
      'an operation step that is not a count',
      { operation: { kind: 'am', step: -1 } },
    ],
    [
      'an operation total that is not a count',
      { operation: { kind: 'am', total: 'x' } },
    ],
    ['counts that are not an object', { counts: 3 }],
    ['a fractional count', { counts: { ...STATE.counts, staged: 1.5 } }],
    ['entries that are not a list', { entries: 'a.ts' }],
    ['an entry that is not an object', { entries: ['a.ts'] }],
    ['an entry with a numeric xy', { entries: [{ xy: 1, path: 'a' }] }],
    [
      'an entry whose from is not text',
      { entries: [{ xy: 'R ', path: 'a', from: 1 }] },
    ],
    ['an omitted count that is negative', { omitted: -1 }],
    ['submodules that are not text', { submodules: [1] }],
    ['a commit without a subject', { commits: [{ short: 'abc' }] }],
    ['a remote without a url', { remotes: [{ name: 'origin' }] }],
    ['an unknown status', { status: 'done' }],
  ])('refuses %s', (_case, override) => {
    expect(
      readGitStateResult({ ...STATE, ...override }, MACHINE),
    ).toBeUndefined();
  });
});

describe('readGitWorktreeAddResult', () => {
  it('accepts the created worktree and a typed failure', () => {
    expect(
      readGitWorktreeAddResult(
        {
          status: 'ok',
          path: 'machine://devl/srv/trees/shop',
          branch: 'llame/shop',
          head: 'b'.repeat(40),
        },
        MACHINE,
      ),
    ).toEqual({
      status: 'ok',
      path: 'machine://devl/srv/trees/shop',
      branch: 'llame/shop',
      head: 'b'.repeat(40),
    });
    expect(
      readGitWorktreeAddResult(
        {
          status: 'error',
          type: 'git_failed',
          stderr: 'fatal: already exists',
        },
        MACHINE,
      ),
    ).toEqual({
      status: 'error',
      type: 'git_failed',
      stderr: 'fatal: already exists',
    });
  });

  it('re-encodes a raw host path and refuses a foreign prefix', () => {
    expect(
      readGitWorktreeAddResult(
        {
          status: 'ok',
          path: 'machine://devl/srv/trees/100%',
          branch: 'llame/shop',
          head: 'b'.repeat(40),
        },
        MACHINE,
      ),
    ).toMatchObject({ path: 'machine://devl/srv/trees/100%25' });
    expect(
      readGitWorktreeAddResult(
        {
          status: 'ok',
          path: 'machine://host/srv/trees/shop',
          branch: 'llame/shop',
          head: 'b'.repeat(40),
        },
        MACHINE,
      ),
    ).toBeUndefined();
  });

  it('refuses an answer without a head', () => {
    expect(
      readGitWorktreeAddResult(
        { status: 'ok', path: 'machine://devl/srv/a', branch: 'b' },
        MACHINE,
      ),
    ).toBeUndefined();
  });
});

describe('readGitWorktreeListResult', () => {
  it('accepts every worktree and re-encodes its raw path', () => {
    expect(
      readGitWorktreeListResult(
        {
          status: 'ok',
          worktrees: [
            {
              path: 'machine://devl/srv/app',
              branch: 'main',
              head: 'a'.repeat(40),
              locked: false,
              prunable: false,
            },
            {
              path: 'machine://devl/srv/trees/100%',
              branch: null,
              head: null,
              locked: true,
              prunable: true,
            },
          ],
        },
        MACHINE,
      ),
    ).toEqual({
      status: 'ok',
      worktrees: [
        {
          path: 'machine://devl/srv/app',
          branch: 'main',
          head: 'a'.repeat(40),
          locked: false,
          prunable: false,
        },
        {
          path: 'machine://devl/srv/trees/100%25',
          branch: null,
          head: null,
          locked: true,
          prunable: true,
        },
      ],
    });
  });

  it('refuses an entry outside the Machine prefix', () => {
    expect(
      readGitWorktreeListResult(
        {
          status: 'ok',
          worktrees: [
            {
              path: 'machine://host/srv/app',
              branch: 'main',
              head: null,
              locked: false,
              prunable: false,
            },
          ],
        },
        MACHINE,
      ),
    ).toBeUndefined();
  });

  it.each([
    [{}],
    [{ status: 'ok' }],
    [{ status: 'ok', worktrees: {} }],
    [
      {
        status: 'ok',
        worktrees: [{ path: 'machine://devl/srv/app', branch: 'main' }],
      },
    ],
    [
      {
        status: 'ok',
        worktrees: [
          {
            path: 'machine://devl/srv/app',
            branch: 'main',
            head: null,
            locked: false,
          },
        ],
      },
    ],
  ])('refuses %j', (value) => {
    expect(readGitWorktreeListResult(value, MACHINE)).toBeUndefined();
  });
});

describe('readGitWorktreeRemoveResult', () => {
  it('accepts success and a typed failure', () => {
    expect(readGitWorktreeRemoveResult({ status: 'ok' })).toEqual({
      status: 'ok',
    });
    expect(
      readGitWorktreeRemoveResult({
        status: 'error',
        type: 'git_failed',
        stderr: 'fatal: contains modified files',
      }),
    ).toMatchObject({ status: 'error', type: 'git_failed' });
  });

  it.each([[{}], [{ status: 'done' }], ['ok']])('refuses %j', (value) => {
    expect(readGitWorktreeRemoveResult(value)).toBeUndefined();
  });
});
