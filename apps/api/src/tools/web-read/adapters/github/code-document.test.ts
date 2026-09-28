import { describe, expect, it } from 'vitest';

import {
  renderGithubCodeDocument,
  type GithubRepositoryDocument,
  type GithubTreeDocument,
} from './code-document';

const treeEntries = [
  { path: 'src', type: 'tree' as const },
  { path: 'README.md', type: 'blob' as const },
  { path: 'zeta.txt', type: 'blob' as const },
  { path: 'src/nested', type: 'tree' as const },
  { path: 'src/nested/ignored.ts', type: 'blob' as const },
  { path: 'src/file-a', type: 'blob' as const },
  { path: 'src/file-b', type: 'blob' as const },
  { path: 'src/file-c', type: 'blob' as const },
  { path: 'src/file-d', type: 'blob' as const },
  { path: 'src/file-e', type: 'blob' as const },
  { path: 'src/file-f', type: 'blob' as const },
  { path: 'src/file-g', type: 'blob' as const },
  { path: 'src/file-h', type: 'blob' as const },
  { path: 'src/file-i', type: 'blob' as const },
  { path: 'src/file-j', type: 'blob' as const },
  { path: 'src/file-k', type: 'blob' as const },
  { path: 'src/file-l', type: 'blob' as const },
  { path: 'src/file-m', type: 'blob' as const },
  { path: 'src/file-n', type: 'blob' as const },
  { path: 'src/file-o', type: 'blob' as const },
  { path: 'src/file-p', type: 'blob' as const },
  { path: 'src/file-q', type: 'blob' as const },
  { path: 'src/file-r', type: 'blob' as const },
  { path: 'src/file-s', type: 'blob' as const },
  { path: 'src/file-t', type: 'blob' as const },
] as const;

const treeDocument: GithubTreeDocument = {
  kind: 'tree',
  displayPath: 'https://github.com/o/r/tree/main/apps',
  entries: treeEntries,
};

const repositoryDocument: GithubRepositoryDocument = {
  kind: 'repository',
  displayPath: 'https://github.com/o/r',
  description: 'A repository for examples.',
  defaultBranch: 'main',
  visibility: 'public',
  language: null,
  entries: treeEntries,
  readme: 'Welcome to the repository.',
};

describe('renderGithubCodeDocument', () => {
  it('renders an ordered two-level tree and caps each child at 20 entries', () => {
    expect(renderGithubCodeDocument(treeDocument))
      .toBe(`https://github.com/o/r/tree/main/apps
  - src/
    - nested/
    - file-a
    - file-b
    - file-c
    - file-d
    - file-e
    - file-f
    - file-g
    - file-h
    - file-i
    - file-j
    - file-k
    - file-l
    - file-m
    - file-n
    - file-o
    - file-p
    - file-q
    - file-r
    - file-s
    … 1 more
  - README.md
  - zeta.txt`);
  });

  it('renders repository metadata, listing, and README', () => {
    expect(renderGithubCodeDocument(repositoryDocument))
      .toBe(`Description: A repository for examples.
Default branch: main
Visibility: public
Language: none

https://github.com/o/r
  - src/
    - nested/
    - file-a
    - file-b
    - file-c
    - file-d
    - file-e
    - file-f
    - file-g
    - file-h
    - file-i
    - file-j
    - file-k
    - file-l
    - file-m
    - file-n
    - file-o
    - file-p
    - file-q
    - file-r
    - file-s
    … 1 more
  - README.md
  - zeta.txt

## README

Welcome to the repository.`);
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
