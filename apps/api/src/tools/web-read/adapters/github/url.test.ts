import { describe, expect, it } from 'vitest';

import { parseGithubUrl } from './url';

describe('parseGithubUrl', () => {
  it('claims repository roots, trees, blobs, and commits', () => {
    expect(
      parseGithubUrl(new URL('https://github.com/acme/project')),
    ).toStrictEqual({
      kind: 'repository',
      owner: 'acme',
      repo: 'project',
    });
    expect(
      parseGithubUrl(
        new URL(
          'https://github.com/acme/project/tree/feature/foo/src?tab=tree#read',
        ),
      ),
    ).toStrictEqual({
      kind: 'tree',
      owner: 'acme',
      repo: 'project',
      segments: ['feature', 'foo', 'src'],
    });
    expect(
      parseGithubUrl(
        new URL('https://github.com/acme/project/blob/main/src/index.ts'),
      ),
    ).toStrictEqual({
      kind: 'blob',
      owner: 'acme',
      repo: 'project',
      segments: ['main', 'src', 'index.ts'],
    });
    expect(
      parseGithubUrl(
        new URL('https://github.com/acme/project/commit/C91B31C0?diff=split'),
      ),
    ).toStrictEqual({
      kind: 'commit',
      owner: 'acme',
      repo: 'project',
      sha: 'C91B31C0',
    });
  });

  it('decodes each tree and blob segment once without splitting encoded slashes', () => {
    expect(
      parseGithubUrl(
        new URL(
          'https://github.com/o/r/tree/main/src%2Fgenerated/index%252Ets',
        ),
      ),
    ).toStrictEqual({
      kind: 'tree',
      owner: 'o',
      repo: 'r',
      segments: ['main', 'src/generated', 'index%2Ets'],
    });
    expect(
      parseGithubUrl(new URL('https://github.com/o/r/tree/main/')),
    ).toStrictEqual({
      kind: 'tree',
      owner: 'o',
      repo: 'r',
      segments: ['main'],
    });
  });

  it('enforces the seven-to-forty hexadecimal SHA bounds', () => {
    expect(
      parseGithubUrl(new URL(`https://github.com/o/r/commit/${'a'.repeat(7)}`)),
    ).toMatchObject({ kind: 'commit', sha: 'a'.repeat(7) });
    expect(
      parseGithubUrl(
        new URL(`https://github.com/o/r/commit/${'A'.repeat(40)}`),
      ),
    ).toMatchObject({ kind: 'commit', sha: 'A'.repeat(40) });
    expect(
      parseGithubUrl(new URL(`https://github.com/o/r/commit/${'a'.repeat(6)}`)),
    ).toBeUndefined();
    expect(
      parseGithubUrl(
        new URL(`https://github.com/o/r/commit/${'a'.repeat(41)}`),
      ),
    ).toBeUndefined();
  });

  it('rejects invalid segments and incomplete code paths', () => {
    const unclaimed = [
      'https://github.com/o/r/tree',
      'https://github.com/o/r/tree/',
      'https://github.com/o/r/tree/main//src',
      'https://github.com/o/r/tree/main/a%2F..%2Fb',
      'https://github.com/o/r/blob/main/%2E%2E%2Fx',
      'https://github.com/o/r/tree/main/%5C/src',
      'https://github.com/o/r/tree/main/%00/src',
      'https://github.com/o/r/tree/main/%09/src',
      'https://github.com/o/r/tree/main/%7F/src',
      'https://github.com/o/r/tree/main/%80/src',
      'https://github.com/o/r/tree/main/%',
      'https://github.com/o/r/blob/main',
      'https://github.com/o/r/blob/main/src/',
      'https://github.com/o/r/blob/main//src',
      'https://github.com/o/r/commit/abcdefg.diff',
      'https://github.com/o/r/commit/abcdefg.patch',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }

    for (const segment of ['%2E', '%2E%2E']) {
      const source = new URL('https://github.com/o/r');
      Object.defineProperty(source, 'pathname', {
        value: `/o/r/tree/main/${segment}/src`,
      });
      expect(parseGithubUrl(source)).toBeUndefined();
    }
  });
  it('only allows a trailing slash for tree paths', () => {
    expect(
      parseGithubUrl(new URL('https://github.com/o/r/blob/main/src/')),
    ).toBeUndefined();
    expect(
      parseGithubUrl(new URL('https://github.com/o/r/tree/main/src/')),
    ).toMatchObject({ kind: 'tree', segments: ['main', 'src'] });
  });

  it('leaves unsupported GitHub shapes unclaimed', () => {
    const unclaimed = [
      'https://github.com/o/r/',
      'https://github.com/o/r/raw/main/file',
      'https://github.com/o/r/compare/main...next',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });
  it('leaves GitHub reserved top-level paths unclaimed', () => {
    const reserved = [
      'about',
      'advisories',
      'apps',
      'codespaces',
      'collections',
      'customer-stories',
      'enterprise',
      'enterprises',
      'explore',
      'features',
      'issues',
      'login',
      'logout',
      'marketplace',
      'new',
      'notifications',
      'organizations',
      'orgs',
      'pricing',
      'pulls',
      'readme',
      'security',
      'search',
      'settings',
      'signup',
      'sponsors',
      'topics',
      'trending',
      'users',
    ];
    for (const name of reserved) {
      expect(
        parseGithubUrl(new URL(`https://github.com/${name}/value`)),
      ).toBeUndefined();
    }
    expect(
      parseGithubUrl(new URL('https://github.com/Topics/value')),
    ).toBeUndefined();
  });
});

describe('parseGithubUrl threads', () => {
  it('claims canonical issues and pull requests while ignoring query and fragment', () => {
    expect(
      parseGithubUrl(
        new URL(
          'https://github.com/acme/project/issues/12?tab=comments#issue-1',
        ),
      ),
    ).toStrictEqual({
      kind: 'issue',
      owner: 'acme',
      repo: 'project',
      number: 12,
    });
    expect(
      parseGithubUrl(new URL('https://github.com/acme/project/pull/34')),
    ).toStrictEqual({
      kind: 'pull',
      owner: 'acme',
      repo: 'project',
      number: 34,
    });
  });

  it('accepts the specified owner, repository, and number boundaries', () => {
    expect(
      parseGithubUrl(
        new URL('https://github.com/A-0/._repo-1/issues/1234567890'),
      ),
    ).toBeDefined();
    expect(
      parseGithubUrl(
        new URL(
          `https://github.com/${'a'.repeat(39)}/${'r'.repeat(100)}/pull/1`,
        ),
      ),
    ).toBeDefined();
  });

  it('leaves unsupported and malformed shapes unclaimed', () => {
    const unclaimed = [
      'http://github.com/o/r/issues/1',
      'https://github.com/o/r/issues/0',
      'https://github.com/o/r/issues/12345678901',
      'https://github.com/-owner/r/issues/1',
      `https://github.com/${'a'.repeat(40)}/r/issues/1`,
      `https://github.com/o/${'r'.repeat(101)}/issues/1`,
      'https://github.com/o/r/issues/1/',
      'https://github.com/o/r/pull/1.diff',
      'https://github.com/o/r/pull/1.patch',
      'https://github.com/o/r/pull/1/files',
      'https://github.com/o/r/pull/1/commits',
      'https://github.com/o/r/pull/1/checks',
      'https://github.com/o/r/issues',
      'https://github.com/o/r/pulls',
      'https://github.com/o/r/actions/runs/1',
      'https://github.com/o/r/projects/1',
      'https://github.com/search?q=issue',
      'https://github.com/o/../issues/1',
      'https://github.com/o/./issues/1',
      'https://github.enterprise.test/o/r/issues/1',
      'https://github.com/o/r/issues/1/comments',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });

  it('rejects a non-default port and userinfo', () => {
    expect(
      parseGithubUrl(new URL('https://github.com:444/o/r/issues/1')),
    ).toBeUndefined();
    expect(
      parseGithubUrl(new URL('https://user:secret@github.com/o/r/issues/1')),
    ).toBeUndefined();
  });
});

describe('parseGithubUrl gists', () => {
  const id = 'aa5a315d61ae9438b18d';

  it('claims a gist with or without its owner, ignoring query and fragment', () => {
    expect(
      parseGithubUrl(new URL(`https://gist.github.com/octocat/${id}`)),
    ).toStrictEqual({ kind: 'gist', id });
    expect(
      parseGithubUrl(new URL(`https://gist.github.com/${id}#file-a-md`)),
    ).toStrictEqual({ kind: 'gist', id });
    expect(
      parseGithubUrl(
        new URL('https://gist.github.com/defunkt/2059?permalink_comment_id=1'),
      ),
    ).toStrictEqual({ kind: 'gist', id: '2059' });
  });

  it('accepts the specified id and owner boundaries', () => {
    for (const bound of ['a'.repeat(20), 'f'.repeat(40), '1', '9'.repeat(10)]) {
      expect(
        parseGithubUrl(new URL(`https://gist.github.com/o/${bound}`)),
      ).toStrictEqual({ kind: 'gist', id: bound });
    }
    expect(
      parseGithubUrl(
        new URL(`https://gist.github.com/${'a'.repeat(39)}/${id}`),
      ),
    ).toBeDefined();
  });

  it('leaves other gist shapes, ids, and hosts unclaimed', () => {
    const unclaimed = [
      'https://gist.github.com/',
      'https://gist.github.com/discover',
      'https://gist.github.com/octocat',
      `https://gist.github.com/octocat/${id}/raw`,
      `https://gist.github.com/octocat/${id}/revisions`,
      `https://gist.github.com/octocat/${id}/`,
      `https://gist.github.com/octocat/${id}.js`,
      `https://gist.github.com/octocat/${'a'.repeat(19)}`,
      `https://gist.github.com/octocat/${'a'.repeat(41)}`,
      `https://gist.github.com/octocat/${'A'.repeat(32)}`,
      'https://gist.github.com/octocat/0123',
      `https://gist.github.com/octocat/${'9'.repeat(11)}`,
      `https://gist.github.com/-octocat/${id}`,
      `https://gist.github.com/${'a'.repeat(40)}/${id}`,
      `http://gist.github.com/octocat/${id}`,
      `https://gist.github.com:444/octocat/${id}`,
      `https://user:secret@gist.github.com/octocat/${id}`,
      `https://www.gist.github.com/octocat/${id}`,
      `https://gist.githubusercontent.com/octocat/${id}/raw`,
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });
});

describe('parseGithubUrl releases', () => {
  it('claims a tag, the latest release, and the list, ignoring query and fragment', () => {
    expect(
      parseGithubUrl(
        new URL(
          'https://github.com/acme/project/releases/tag/v1.2.3?expanded=true#top',
        ),
      ),
    ).toStrictEqual({
      kind: 'release',
      owner: 'acme',
      repo: 'project',
      tag: 'v1.2.3',
    });
    expect(
      parseGithubUrl(
        new URL('https://github.com/acme/project/releases/latest?x=1'),
      ),
    ).toStrictEqual({
      kind: 'latest-release',
      owner: 'acme',
      repo: 'project',
    });
    expect(
      parseGithubUrl(
        new URL('https://github.com/acme/project/releases?per_page=5'),
      ),
    ).toStrictEqual({
      kind: 'release-list',
      owner: 'acme',
      repo: 'project',
    });
  });

  it('decodes each tag component once and joins them with slashes', () => {
    const tags = [
      ['%40changesets/cli%402.27.0', '@changesets/cli@2.27.0'],
      ['release%2F1.0', 'release/1.0'],
      ['release/1.0', 'release/1.0'],
      ['v1.0%2B5%23x', 'v1.0+5#x'],
      ['v1%252F', 'v1%2F'],
    ] as const;
    for (const [encoded, tag] of tags) {
      expect(
        parseGithubUrl(
          new URL(`https://github.com/o/r/releases/tag/${encoded}`),
        ),
      ).toStrictEqual({ kind: 'release', owner: 'o', repo: 'r', tag });
    }
  });

  it('leaves downloads, later list pages, and malformed tags unclaimed', () => {
    const unclaimed = [
      'https://github.com/o/r/releases/tag',
      'https://github.com/o/r/releases/tag/',
      'https://github.com/o/r/releases/tag/v1/',
      'https://github.com/o/r/releases/tag/a//b',
      'https://github.com/o/r/releases/tag/%2F',
      'https://github.com/o/r/releases/tag/%5C',
      'https://github.com/o/r/releases/tag/%00',
      'https://github.com/o/r/releases/tag/%',
      'https://github.com/o/r/releases/tags/v1',
      'https://github.com/o/r/releases/latest/',
      'https://github.com/o/r/releases/latest/download/x.zip',
      'https://github.com/o/r/releases/download/v1/x.zip',
      'https://github.com/o/r/releases/new',
      'https://github.com/o/r/releases.atom',
      'https://github.com/o/r/releases/',
      'https://github.com/o/r/releases?page=2',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });
});

describe('parseGithubUrl Actions jobs', () => {
  it('claims a job link, ignoring query and fragment', () => {
    expect(
      parseGithubUrl(
        new URL(
          'https://github.com/cli/cli/actions/runs/37655119172/job/112909335290?pr=1#step:5:10',
        ),
      ),
    ).toStrictEqual({
      kind: 'job',
      owner: 'cli',
      repo: 'cli',
      job: '112909335290',
    });
  });

  it('accepts ids of up to 15 digits and no more', () => {
    const claimed = `https://github.com/o/r/actions/runs/${'9'.repeat(15)}/job/${'9'.repeat(15)}`;
    expect(parseGithubUrl(new URL(claimed))).toMatchObject({
      job: '9'.repeat(15),
    });
    for (const source of [
      `https://github.com/o/r/actions/runs/${'9'.repeat(16)}/job/1`,
      `https://github.com/o/r/actions/runs/1/job/${'9'.repeat(16)}`,
    ]) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });

  it('leaves runs, other job spellings, and malformed ids unclaimed', () => {
    const unclaimed = [
      'https://github.com/o/r/actions/runs/1',
      'https://github.com/o/r/actions/runs/1/jobs/2',
      'https://github.com/o/r/actions/runs/1/job',
      'https://github.com/o/r/actions/runs/1/job/',
      'https://github.com/o/r/actions/runs/0/job/1',
      'https://github.com/o/r/actions/runs/1/job/0',
      'https://github.com/o/r/actions/runs/01/job/1',
      'https://github.com/o/r/actions/runs/1/job/01',
      'https://github.com/o/r/actions/runs/1/job/2/',
      'https://github.com/o/r/actions/runs/1/attempts/1/job/2',
      'https://github.com/o/r/actions/runs/a/job/2',
      'https://github.com/o/r/actions/runs/1/job/b',
      'https://github.com/o/r/runs/2',
      'https://github.com/o/r/actions/jobs/2',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });
});

describe('parseGithubUrl discussions', () => {
  it('claims a discussion, ignoring query and fragment', () => {
    expect(
      parseGithubUrl(
        new URL(
          'https://github.com/acme/project/discussions/12?sort=top#discussioncomment-3',
        ),
      ),
    ).toStrictEqual({
      kind: 'discussion',
      owner: 'acme',
      repo: 'project',
      number: 12,
    });
  });

  it('accepts numbers of up to ten digits and no more', () => {
    expect(
      parseGithubUrl(new URL('https://github.com/o/r/discussions/1')),
    ).toMatchObject({ number: 1 });
    expect(
      parseGithubUrl(new URL('https://github.com/o/r/discussions/1234567890')),
    ).toMatchObject({ number: 1_234_567_890 });
    expect(
      parseGithubUrl(new URL('https://github.com/o/r/discussions/12345678901')),
    ).toBeUndefined();
  });

  it('leaves lists, categories, and malformed numbers unclaimed', () => {
    const unclaimed = [
      'https://github.com/o/r/discussions',
      'https://github.com/o/r/discussions/0',
      'https://github.com/o/r/discussions/01',
      'https://github.com/o/r/discussions/12/',
      'https://github.com/o/r/discussions/categories/q-a',
      'https://github.com/o/r/discussions/12/comments',
      'http://github.com/o/r/discussions/12',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });

  it('leaves reserved top-level owners unclaimed for every new repository shape', () => {
    const unclaimed = [
      'https://github.com/orgs/community/discussions/1',
      'https://github.com/Orgs/community/discussions/1',
      'https://github.com/settings/x/releases',
      'https://github.com/settings/x/releases/latest',
      'https://github.com/settings/x/releases/tag/v1',
      'https://github.com/settings/x/actions/runs/1/job/2',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
  });
});
