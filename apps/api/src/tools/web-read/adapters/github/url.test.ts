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
      'https://github.com/o/r/tree/',
      'https://github.com/o/r/tree/main//src',
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

  it('leaves unsupported GitHub shapes and hosts unclaimed', () => {
    const unclaimed = [
      'http://github.com/o/r',
      'https://github.com/o/r/',
      'https://github.com/o/r/raw/main/file',
      'https://github.com/o/r/compare/main...next',
      'https://raw.githubusercontent.com/o/r/main/file',
      'https://github.enterprise.test/o/r/tree/main',
      'https://user:secret@github.com/o/r/tree/main',
      'https://github.com:444/o/r/tree/main',
    ];
    for (const source of unclaimed) {
      expect(parseGithubUrl(new URL(source))).toBeUndefined();
    }
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
      'https://github.com/o/r/discussions/1',
      'https://github.com/search?q=issue',
      'https://gist.github.com/o/1',
      'https://raw.githubusercontent.com/o/r/main/file',
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
