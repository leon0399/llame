import {
  readGitInspectResult,
  readGitStatusResult,
  readGitWorktreeAddResult,
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

  it('returns a typed failure unchanged', () => {
    const failure = { status: 'error', type: 'timed_out', stderr: '' };
    expect(readGitInspectResult(failure, MACHINE)).toEqual(failure);
  });

  it.each([
    ['a missing toplevel', { ...INSPECTED, toplevel: undefined }],
    ['a link flag that is not a boolean', { ...INSPECTED, linked: 'no' }],
    ['a remote that is not a record', { ...INSPECTED, remotes: [7] }],
    ['a remote without a url', { ...INSPECTED, remotes: [{ name: 'origin' }] }],
    ['a branch that is not text or null', { ...INSPECTED, branch: 7 }],
    ['an unknown status', { ...INSPECTED, status: 'done' }],
  ])('refuses %s', (_case, value) => {
    expect(readGitInspectResult(value, MACHINE)).toBeUndefined();
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
