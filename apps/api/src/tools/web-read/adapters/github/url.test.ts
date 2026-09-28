import { describe, expect, it } from 'vitest';

import { parseGithubThreadUrl } from './url';

describe('parseGithubThreadUrl', () => {
  it('claims canonical issues and pull requests while ignoring query and fragment', () => {
    expect(
      parseGithubThreadUrl(
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
      parseGithubThreadUrl(new URL('https://github.com/acme/project/pull/34')),
    ).toStrictEqual({
      kind: 'pull',
      owner: 'acme',
      repo: 'project',
      number: 34,
    });
  });

  it('accepts the specified owner, repository, and number boundaries', () => {
    expect(
      parseGithubThreadUrl(
        new URL('https://github.com/A-0/._repo-1/issues/1234567890'),
      ),
    ).toBeDefined();
    expect(
      parseGithubThreadUrl(
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
      'https://github.com/o/./issues/1',
      'https://github.com/o/../issues/1',
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
      expect(parseGithubThreadUrl(new URL(source))).toBeUndefined();
    }
  });

  it('rejects invalid owner and repository lengths', () => {
    expect(
      parseGithubThreadUrl(
        new URL(`https://github.com/${'a'.repeat(40)}/r/issues/1`),
      ),
    ).toBeUndefined();
    expect(
      parseGithubThreadUrl(
        new URL(`https://github.com/o/${'r'.repeat(101)}/issues/1`),
      ),
    ).toBeUndefined();
    expect(
      parseGithubThreadUrl(new URL('https://github.com/o/./issues/1')),
    ).toBeUndefined();
    expect(
      parseGithubThreadUrl(new URL('https://github.com/o/../issues/1')),
    ).toBeUndefined();
  });

  it('rejects a non-default port and userinfo', () => {
    expect(
      parseGithubThreadUrl(new URL('https://github.com:444/o/r/issues/1')),
    ).toBeUndefined();
    expect(
      parseGithubThreadUrl(
        new URL('https://user:secret@github.com/o/r/issues/1'),
      ),
    ).toBeUndefined();
  });
});
