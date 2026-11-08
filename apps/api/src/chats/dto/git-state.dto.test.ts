import { describe, expect, it } from 'vitest';

import { type GitStateView } from '../../git-state/git-state-view';
import { toGitStateResponse } from './git-state.dto';

const VIEW: GitStateView = {
  toplevel: '/home/dev/src/llame',
  rootRelative: '',
  branch: 'main',
  detached: false,
  head: { short: 'abc1234', oid: 'abc1234def' },
  upstream: {
    name: 'origin/main',
    gone: false,
    ahead: 1,
    behind: 0,
    updatedAt: null,
  },
  operation: { kind: 'rebase', step: 3, total: 7 },
  counts: { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 },
  entries: [{ xy: 'R ', path: 'b.ts', from: 'a.ts' }],
  omitted: 0,
  submodules: ['vendor/lib'],
  commits: [{ short: 'abc1234', subject: 'fix' }],
  remotes: [{ name: 'origin', value: 'github.com/leon0399/llame' }],
  remotesOmitted: 0,
};

describe('toGitStateResponse', () => {
  it('answers the declared fields of a state view', () => {
    expect(toGitStateResponse({ kind: 'state', view: VIEW })).toEqual({
      status: 'ok',
      ...VIEW,
    });
  });

  it('drops a property the view carries but the response does not declare', () => {
    const view = {
      ...VIEW,
      rawRemote: 'https://ghp_secret@github.com/x',
      head: { short: 'abc1234', oid: 'abc1234def', rawRef: 'refs/heads/main' },
      entries: [{ xy: 'R ', path: 'b.ts', from: 'a.ts', raw: 'x' }],
    };

    const body = JSON.stringify(toGitStateResponse({ kind: 'state', view }));

    expect(body).not.toContain('ghp_secret');
    expect(body).not.toContain('rawRef');
    expect(body).not.toContain('"raw"');
  });

  it('omits step, total and from when the view has none', () => {
    const view: GitStateView = {
      ...VIEW,
      operation: { kind: 'merge' },
      entries: [{ xy: ' M', path: 'c.ts' }],
    };

    expect(toGitStateResponse({ kind: 'state', view })).toStrictEqual({
      status: 'ok',
      ...view,
    });
  });
});
