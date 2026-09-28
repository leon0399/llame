import { describe, expect, it } from 'vitest';

import {
  renderGithubDocument,
  type GithubIssueDocument,
  type GithubPullDocument,
} from './document';

const issueDocument: GithubIssueDocument = {
  kind: 'issue',
  number: 12,
  title: 'Fix the thing',
  state: 'closed',
  stateReason: 'completed',
  author: 'alice',
  createdAt: '2026-09-20T10:00:00Z',
  updatedAt: '2026-09-21T11:00:00Z',
  labels: ['bug', 'docs'],
  url: 'https://github.com/o/r/issues/12',
  body: 'Please fix this.',
  comments: [
    {
      id: 1,
      author: 'bob',
      createdAt: '2026-09-21T12:00:00Z',
      url: 'https://github.com/o/r/issues/12#issuecomment-1',
      body: 'I can reproduce it.',
    },
    {
      id: 2,
      author: 'carol',
      createdAt: '2026-09-21T13:00:00Z',
      url: 'https://github.com/o/r/issues/12#issuecomment-2',
      body: 'Thanks for the report.',
    },
  ],
};

const pullDocument: GithubPullDocument = {
  kind: 'pull',
  number: 42,
  title: 'Improve docs',
  state: 'merged',
  draft: false,
  author: 'alice',
  base: 'main',
  head: 'feature/docs',
  mergeableState: 'clean',
  createdAt: '2026-09-20T10:00:00Z',
  updatedAt: '2026-09-22T11:00:00Z',
  labels: ['documentation', 'good first issue'],
  url: 'https://github.com/o/r/pull/42',
  diffUrl: 'https://github.com/o/r/pull/42.diff',
  body: 'This updates the documentation.',
  files: [
    {
      filename: 'docs/new.md',
      status: 'added',
      additions: 10,
      deletions: 0,
    },
    {
      filename: 'docs/current.md',
      status: 'renamed',
      additions: 3,
      deletions: 1,
      previousFilename: 'docs/original.md',
    },
  ],
  reviews: [
    {
      id: 10,
      author: 'alice',
      submittedAt: '2026-09-21T10:00:00Z',
      state: 'APPROVED',
      url: 'https://github.com/o/r/pull/42#pullrequestreview-10',
      body: 'Looks good.',
    },
    {
      id: 11,
      author: 'alice',
      submittedAt: '2026-09-21T11:00:00Z',
      state: 'COMMENTED',
      url: 'https://github.com/o/r/pull/42#pullrequestreview-11',
      body: 'One small thought.',
    },
    {
      id: 12,
      author: 'bob',
      submittedAt: '2026-09-21T12:00:00Z',
      state: 'CHANGES_REQUESTED',
      url: 'https://github.com/o/r/pull/42#pullrequestreview-12',
      body: 'Please adjust the example.',
    },
  ],
  reviewComments: [
    {
      id: 31,
      author: 'carol',
      createdAt: '2026-09-21T13:00:00Z',
      url: 'https://github.com/o/r/pull/42#discussion_r31',
      body: 'This paragraph needs a link.',
      path: 'docs/current.md',
      line: 27,
      side: 'RIGHT',
      inReplyTo: 22,
    },
  ],
  comments: [
    {
      id: 41,
      author: 'dave',
      createdAt: '2026-09-21T14:00:00Z',
      url: 'https://github.com/o/r/pull/42#issuecomment-41',
      body: 'The rendered docs look good.',
    },
  ],
  checks: {
    kind: 'loaded',
    passed: 14,
    failed: ['lint'],
    pending: 2,
    notLoaded: 0,
  },
};

describe('renderGithubDocument', () => {
  it('renders an issue with state reason, labels, and comments', () => {
    expect(renderGithubDocument(issueDocument)).toBe(`# Issue #12: Fix the thing

State: closed
State reason: completed
Author: alice
Created: 2026-09-20T10:00:00Z
Updated: 2026-09-21T11:00:00Z
Labels: bug, docs
URL: https://github.com/o/r/issues/12

## Body

Please fix this.

## Comments (2)

### bob · 2026-09-21T12:00:00Z

ID: 1
URL: https://github.com/o/r/issues/12#issuecomment-1

I can reproduce it.

### carol · 2026-09-21T13:00:00Z

ID: 2
URL: https://github.com/o/r/issues/12#issuecomment-2

Thanks for the report.`);
  });

  it('renders a pull request with files, reviews, review comments, checks, and comments', () => {
    expect(renderGithubDocument(pullDocument))
      .toBe(`# Pull Request #42: Improve docs

State: merged
Draft: false
Author: alice
Base: main
Head: feature/docs
Reviews: 1 approved, 1 changes requested (latest per reviewer)
Merge state: clean
Checks: 14 passed, 1 failed (lint), 2 pending
Created: 2026-09-20T10:00:00Z
Updated: 2026-09-22T11:00:00Z
Labels: documentation, good first issue
URL: https://github.com/o/r/pull/42
Diff: https://github.com/o/r/pull/42.diff

## Body

This updates the documentation.

## Files (2)
- docs/new.md (added, +10 -0)
- docs/current.md (renamed, +3 -1) (renamed from docs/original.md)

## Reviews (3)

### alice · 2026-09-21T10:00:00Z

ID: 10
State: APPROVED
URL: https://github.com/o/r/pull/42#pullrequestreview-10

Looks good.

### alice · 2026-09-21T11:00:00Z

ID: 11
State: COMMENTED
URL: https://github.com/o/r/pull/42#pullrequestreview-11

One small thought.

### bob · 2026-09-21T12:00:00Z

ID: 12
State: CHANGES_REQUESTED
URL: https://github.com/o/r/pull/42#pullrequestreview-12

Please adjust the example.

## Review Comments (1)

### carol · 2026-09-21T13:00:00Z

ID: 31
Reply to: 22
Location: docs/current.md:27
Side: RIGHT
URL: https://github.com/o/r/pull/42#discussion_r31

This paragraph needs a link.

## Comments (1)

### dave · 2026-09-21T14:00:00Z

ID: 41
URL: https://github.com/o/r/pull/42#issuecomment-41

The rendered docs look good.`);
  });

  it('renders checks with no runs, an unloaded remainder, or unavailable data', () => {
    const none = renderGithubDocument({
      ...pullDocument,
      checks: {
        kind: 'loaded',
        passed: 0,
        failed: [],
        pending: 0,
        notLoaded: 0,
      },
    });
    const partial = renderGithubDocument({
      ...pullDocument,
      checks: {
        kind: 'loaded',
        passed: 97,
        failed: ['lint'],
        pending: 2,
        notLoaded: 40,
      },
    });
    const unavailable = renderGithubDocument({
      ...pullDocument,
      checks: { kind: 'unavailable' },
    });

    expect(none).toContain('Checks: none');
    expect(partial).toContain(
      'Checks: 97 passed, 1 failed (lint), 2 pending, 40 not loaded',
    );
    expect(unavailable).toContain('Checks: unavailable');
  });

  it('removes an earlier verdict when a later review is dismissed', () => {
    const document: GithubPullDocument = {
      ...pullDocument,
      reviews: [
        pullDocument.reviews[0],
        {
          ...pullDocument.reviews[0],
          id: 13,
          state: 'DISMISSED',
        },
      ],
    };

    expect(renderGithubDocument(document)).toContain('Reviews: none');
  });
});
