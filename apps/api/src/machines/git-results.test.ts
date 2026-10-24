import {
  readGitFailure,
  readGitInspectResult,
  readGitStatusResult,
  readGitWorktreeAddResult,
  readGitWorktreeListResult,
  readGitWorktreeRemoveResult,
} from './git-results';

describe('readGitFailure', () => {
  it('accepts each refusal type the git surface answers', () => {
    expect(
      readGitFailure({
        status: 'error',
        type: 'invalid_input',
        message: 'A base ref must not start with `-`.',
      }),
    ).toEqual({
      status: 'error',
      type: 'invalid_input',
      message: 'A base ref must not start with `-`.',
    });
    for (const type of ['not_a_repository', 'timed_out', 'git_failed']) {
      expect(
        readGitFailure({
          status: 'error',
          type,
          stderr: 'fatal: no repository',
        }),
      ).toEqual({ status: 'error', type, stderr: 'fatal: no repository' });
    }
  });

  it.each([
    [{}],
    [{ status: 'ok' }],
    [{ status: 'error', type: 'nope', stderr: 'x' }],
    [{ status: 'error', type: 'git_failed' }],
    [{ status: 'error', type: 'invalid_input', message: 7 }],
  ])('refuses %j', (value) => {
    expect(readGitFailure(value)).toBeUndefined();
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
    expect(readGitInspectResult(INSPECTED)).toEqual(INSPECTED);
  });

  it('accepts a linked worktree with a null branch', () => {
    expect(
      readGitInspectResult({
        ...INSPECTED,
        linked: true,
        mainWorktree: 'machine://devl/srv/app',
        branch: null,
      }),
    ).toMatchObject({ linked: true, branch: null });
  });

  it('returns a typed failure unchanged', () => {
    const failure = { status: 'error', type: 'timed_out', stderr: '' };
    expect(readGitInspectResult(failure)).toEqual(failure);
  });

  it.each([
    ['a missing toplevel', { ...INSPECTED, toplevel: undefined }],
    ['a link flag that is not a boolean', { ...INSPECTED, linked: 'no' }],
    ['a remote that is not a record', { ...INSPECTED, remotes: [7] }],
    ['a remote without a url', { ...INSPECTED, remotes: [{ name: 'origin' }] }],
    ['a branch that is not text or null', { ...INSPECTED, branch: 7 }],
    ['an unknown status', { ...INSPECTED, status: 'done' }],
  ])('refuses %s', (_case, value) => {
    expect(readGitInspectResult(value)).toBeUndefined();
  });
});

describe('readGitStatusResult', () => {
  it('accepts a status with and without an upstream', () => {
    expect(
      readGitStatusResult({
        status: 'ok',
        dirty: true,
        ahead: 2,
        upstream: 'origin/main',
        head: 'a'.repeat(40),
      }),
    ).toEqual({
      status: 'ok',
      dirty: true,
      ahead: 2,
      upstream: 'origin/main',
      head: 'a'.repeat(40),
    });
    expect(
      readGitStatusResult({ status: 'ok', dirty: false, ahead: 0, head: null }),
    ).toEqual({ status: 'ok', dirty: false, ahead: 0, head: null });
  });

  it.each([
    ['a dirty flag that is not a boolean', { dirty: 'yes' }],
    ['a negative count', { ahead: -1 }],
    ['a fractional count', { ahead: 1.5 }],
    ['an upstream that is not text', { upstream: 7 }],
    ['a head that is not text', { head: 7 }],
  ])('refuses %s', (_case, override) => {
    expect(
      readGitStatusResult({
        status: 'ok',
        dirty: false,
        ahead: 0,
        head: 'a'.repeat(40),
        ...override,
      }),
    ).toBeUndefined();
  });
});

describe('readGitWorktreeAddResult', () => {
  it('accepts the created worktree and a typed failure', () => {
    expect(
      readGitWorktreeAddResult({
        status: 'ok',
        path: 'machine://devl/srv/trees/shop',
        branch: 'llame/shop',
        head: 'b'.repeat(40),
      }),
    ).toEqual({
      status: 'ok',
      path: 'machine://devl/srv/trees/shop',
      branch: 'llame/shop',
      head: 'b'.repeat(40),
    });
    expect(
      readGitWorktreeAddResult({
        status: 'error',
        type: 'git_failed',
        stderr: 'fatal: already exists',
      }),
    ).toEqual({
      status: 'error',
      type: 'git_failed',
      stderr: 'fatal: already exists',
    });
  });

  it('refuses an answer without a head', () => {
    expect(
      readGitWorktreeAddResult({ status: 'ok', path: '/srv/a', branch: 'b' }),
    ).toBeUndefined();
  });
});

describe('readGitWorktreeListResult', () => {
  it('accepts each entry, with a detached branch read as null', () => {
    expect(
      readGitWorktreeListResult({
        status: 'ok',
        worktrees: [
          {
            path: 'machine://devl/srv/app',
            branch: 'main',
            head: 'c'.repeat(40),
            locked: false,
            prunable: false,
          },
          {
            path: 'machine://devl/srv/detached',
            branch: null,
            head: 'd'.repeat(40),
            locked: true,
            prunable: true,
          },
        ],
      }),
    ).toMatchObject({
      worktrees: [{ branch: 'main' }, { branch: null, locked: true }],
    });
  });

  it.each([
    ['an entry that is not a record', [7]],
    ['an entry without a path', [{ locked: false, prunable: false }]],
    ['a lock flag that is not a boolean', [{ path: '/a', locked: 'no' }]],
  ])('refuses %s', (_case, worktrees) => {
    expect(
      readGitWorktreeListResult({ status: 'ok', worktrees }),
    ).toBeUndefined();
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
