import { describe, expect, it } from 'vitest';

import {
  renderGithubCodeDocument,
  type GithubRepositoryDocument,
} from './code-document';

const repositoryEntries = [
  { path: 'src', type: 'tree' as const },
  { path: 'README.md', type: 'blob' as const },
  { path: 'src/nested', type: 'tree' as const },
  { path: 'src/index.ts', type: 'blob' as const },
  { path: 'src/nested/ignored.ts', type: 'blob' as const },
] as const;

const repositoryDocument: GithubRepositoryDocument = {
  kind: 'repository',
  displayPath: 'https://github.com/o/r',
  description: 'A repository for examples.',
  defaultBranch: 'main',
  visibility: 'public',
  language: null,
  entries: repositoryEntries,
  readme: 'Welcome to the repository.',
};

describe('renderGithubCodeDocument', () => {
  it('renders repository metadata, native listing, and README', () => {
    expect(renderGithubCodeDocument(repositoryDocument)).toBe(
      `Description: A repository for examples.
Default branch: main
Visibility: public
Language: none

https://github.com/o/r
  - src/
    - nested/
    - index.ts
  - README.md

## README

Welcome to the repository.`,
    );
  });

  it('renders repository metadata when tree and README are unavailable', () => {
    expect(
      renderGithubCodeDocument({
        kind: 'repository',
        displayPath: 'https://github.com/o/r',
        description: null,
        defaultBranch: 'main',
        visibility: 'private',
        language: null,
      }),
    ).toBe(`Description: none
Default branch: main
Visibility: private
Language: none`);
  });

  it('renders a commit summary and file counts without patches', () => {
    expect(
      renderGithubCodeDocument({
        kind: 'commit',
        sha: 'c91b31c012345678901234567890123456789012',
        message: 'Implement the code reader.',
        author: 'alice',
        authoredAt: '2026-09-24T12:00:00Z',
        files: [
          {
            filename: 'src/new.ts',
            status: 'added',
            additions: 10,
            deletions: 0,
          },
          {
            filename: 'src/old.ts',
            status: 'modified',
            additions: 2,
            deletions: 1,
          },
        ],
        diffUrl: 'https://github.com/o/r/commit/c91b31c0.diff',
      }),
    ).toBe(`# Commit c91b31c012345678901234567890123456789012

Implement the code reader.

Author: alice
Date: 2026-09-24T12:00:00Z

## Files (2)
- src/new.ts (added, +10 -0)
- src/old.ts (modified, +2 -1)

Diff: https://github.com/o/r/commit/c91b31c0.diff`);
  });
});
