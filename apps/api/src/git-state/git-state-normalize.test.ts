import { type GitStateSuccess } from '@workspace/machine-protocol';

import { normalizeGitState } from './git-state-normalize';

const BASE: GitStateSuccess = {
  status: 'ok',
  toplevel: '/home/dev/src/mono',
  rootRelative: '',
  branch: 'main',
  detached: false,
  head: 'abc1234def5678abc1234def5678abc1234def56',
  upstream: {
    name: 'origin/main',
    gone: false,
    ahead: 0,
    behind: 0,
    updatedAt: '2026-11-08T09:12:44.000Z',
  },
  operation: null,
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  entries: [],
  omitted: 0,
  submodules: [],
  commits: [],
  remotes: [],
};

function remoteValue(url: string): string | undefined {
  return normalizeGitState({ ...BASE, remotes: [{ name: 'o', url }] })
    .remotes[0]?.value;
}

describe('normalizeGitState remote value', () => {
  it.each([
    [' https://github.com/o/r ', 'github.com/o/r'],
    ['https:: https://github.com/o/r', 'github.com/o/r'],
    ['github.com:repo', 'github.com/repo'],
    ['https://u:tok/@github.com/o/r', 'github.com/o/r'],
    ['https://a@github.com/o/r', 'github.com/o/r'],
  ])('shows %j as %s', (url, expected) => {
    expect(remoteValue(url)).toBe(expected);
  });

  it.each([
    'dir/a:b',
    'ext::ab:/c',
    ' ext::ab:/c',
    'https:///o/r',
    'https://./o/r',
    'https://~/o/r',
    String.raw`https://host/o\r`,
    'https://',
  ])('shows %j as local', (url) => {
    expect(remoteValue(url)).toBe('local');
  });
});

describe('normalizeGitState bounds', () => {
  it('rejects an upstream time that is not a four-digit year', () => {
    const view = normalizeGitState({
      ...BASE,
      upstream: { ...BASE.upstream!, updatedAt: '+275760-09-13T00:00:00.000Z' },
    });

    expect(view.upstream?.updatedAt).toBeNull();
  });

  it('lists a submodule path of exactly 4,096 characters', () => {
    const path = 'a'.repeat(4096);
    const view = normalizeGitState({ ...BASE, submodules: [path] });

    expect(view.submodules).toEqual([path]);
    expect(view.omitted).toBe(0);
  });
});
