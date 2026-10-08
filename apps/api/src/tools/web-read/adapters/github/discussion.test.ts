import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  config,
  response,
  scriptedIo,
  type JsonObject,
  type JsonValue,
  type Reply,
} from '../../../../testing/github-test-io';
import { createGithubAdapter } from './adapter';
import type { WebAdapterOutcome } from '../contract';

const SOURCE = 'https://github.com/acme/project/discussions/5';
const GRAPHQL_URL = `${API_ORIGIN}/graphql`;
const SENT_BODY = z.object({
  query: z.string(),
  variables: z.object({
    owner: z.string(),
    name: z.string(),
    number: z.number(),
  }),
});

function authored(
  login: string | null,
  id: number,
  body: string,
  extra: JsonObject = {},
): JsonObject {
  return {
    author: login === null ? null : { login },
    createdAt: `2026-01-0${id - 6}T00:00:00Z`,
    url: `${SOURCE}#discussioncomment-${id}`,
    body,
    ...extra,
  };
}

function comment(
  login: string | null,
  id: number,
  body: string,
  extra: JsonObject = {},
): JsonObject {
  return authored(login, id, body, {
    isAnswer: false,
    replies: { totalCount: 0, nodes: [] },
    ...extra,
  });
}

function discussion(extra: JsonObject = {}): JsonObject {
  return {
    number: 5,
    title: 'How do I X?',
    url: SOURCE,
    closed: false,
    stateReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    body: 'Question body',
    author: { login: 'alice' },
    category: { name: 'Q&A' },
    labels: { nodes: [{ name: 'bug' }, { name: 'help wanted' }] },
    answer: null,
    comments: { totalCount: 0, nodes: [] },
    ...extra,
  };
}

function data(value: JsonValue): Reply {
  return response({ data: { repository: { discussion: value } } });
}

function failure(
  httpStatus: number,
  rateLimit?: WebFetchFailure['rateLimit'],
): WebFetchFailure {
  const result: WebFetchFailure = {
    type: 'http_status',
    message: `HTTP ${httpStatus}`,
    httpStatus,
  };
  return rateLimit === undefined ? result : { ...result, rateLimit };
}

async function readDiscussion(reply: Reply, token = 'secret-value') {
  const run = scriptedIo(new Map([[GRAPHQL_URL, [reply]]]));
  const outcome = await createGithubAdapter(config(token), {
    apiOrigin: API_ORIGIN,
  }).read(new URL(SOURCE), run.io);
  return { outcome, requests: run.requests };
}

function contentOf(outcome: WebAdapterOutcome): string {
  if (outcome.kind !== 'rendered') throw new Error('expected a render');
  return outcome.content;
}

describe('GitHub discussion adapter', () => {
  it('posts one GraphQL query with the discussion coordinates and the token', async () => {
    const { requests } = await readDiscussion(data(discussion()));

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(GRAPHQL_URL);
    expect(request?.init).toMatchObject({
      accept: 'application/json',
      authorization: { origin: API_ORIGIN, value: 'Bearer secret-value' },
      body: { contentType: 'application/json' },
    });
    const sent = SENT_BODY.parse(JSON.parse(request?.init?.body?.text ?? ''));
    expect(sent.variables).toStrictEqual({
      owner: 'acme',
      name: 'project',
      number: 5,
    });
    expect(sent.query).toContain('discussion(number: $number)');
    expect(sent.query).toContain('comments(first: 100)');
    expect(sent.query).toContain('replies(first: 20)');
  });

  it('renders the answer, body, comments, and replies in the issue layout', async () => {
    const answer = authored('bob', 7, 'Use X.');
    const { outcome } = await readDiscussion(
      data(
        discussion({
          answer,
          comments: {
            totalCount: 2,
            nodes: [
              comment('bob', 7, 'Use X.', {
                isAnswer: true,
                replies: {
                  totalCount: 2,
                  nodes: [
                    authored('carol', 8, 'Thanks!'),
                    authored(null, 9, ''),
                  ],
                },
              }),
              comment('dave', 10, ''),
            ],
          },
        }),
      ),
    );

    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Discussion #5: How do I X?',
        '',
        'State: open',
        'Category: Q&A',
        'Author: alice',
        'Created: 2026-01-01T00:00:00Z',
        'Updated: 2026-01-02T00:00:00Z',
        'Labels: bug, help wanted',
        `URL: ${SOURCE}`,
        '',
        '## Answer',
        '',
        '### bob · 2026-01-01T00:00:00Z',
        '',
        `URL: ${SOURCE}#discussioncomment-7`,
        '',
        'Use X.',
        '',
        '## Body',
        '',
        'Question body',
        '',
        '## Comments (2)',
        '',
        '### bob · 2026-01-01T00:00:00Z',
        '',
        `URL: ${SOURCE}#discussioncomment-7`,
        'Answer: yes',
        '',
        'Use X.',
        '',
        '#### carol · 2026-01-02T00:00:00Z',
        '',
        `URL: ${SOURCE}#discussioncomment-8`,
        'Reply to: bob',
        '',
        'Thanks!',
        '',
        '#### ghost · 2026-01-03T00:00:00Z',
        '',
        `URL: ${SOURCE}#discussioncomment-9`,
        'Reply to: bob',
        '',
        'No comment body.',
        '',
        '### dave · 2026-01-04T00:00:00Z',
        '',
        `URL: ${SOURCE}#discussioncomment-10`,
        '',
        'No comment body.',
      ].join('\n'),
    });
  });

  it('renders a closed discussion with its lowercase reason and no labels', async () => {
    const closed = await readDiscussion(
      data(
        discussion({
          closed: true,
          stateReason: 'RESOLVED',
          labels: { nodes: [] },
          body: '',
        }),
      ),
    );
    const reopened = await readDiscussion(
      data(discussion({ stateReason: 'REOPENED', labels: null })),
    );

    expect(contentOf(closed.outcome)).toContain(
      'State: closed\nState reason: resolved\nCategory: Q&A',
    );
    expect(contentOf(closed.outcome)).toContain('Labels: none');
    expect(contentOf(closed.outcome)).toContain(
      '## Body\n\nNo description provided.\n\n## Comments (0)',
    );
    expect(contentOf(reopened.outcome)).toContain(
      'State: open\nState reason: reopened',
    );
    expect(contentOf(reopened.outcome)).toContain('Labels: none');
  });

  it('names a deleted author ghost and drops unresolved nodes', async () => {
    const { outcome } = await readDiscussion(
      data(
        discussion({
          author: null,
          comments: {
            totalCount: 3,
            nodes: [null, comment('bob', 7, 'Kept'), null],
          },
        }),
      ),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['comments truncated: the first 1 of 3'],
    });
    expect(contentOf(outcome)).toContain('Author: ghost');
    expect(contentOf(outcome)).toContain('## Comments (1)');
  });

  it('notes comments and replies that were not loaded, and nothing when all were', async () => {
    const cut = await readDiscussion(
      data(
        discussion({
          comments: {
            totalCount: 230,
            nodes: [
              comment('bob', 7, 'One', {
                replies: {
                  totalCount: 140,
                  nodes: [authored('carol', 8, 'Two')],
                },
              }),
              comment('dave', 10, 'Three', {
                replies: {
                  totalCount: 1,
                  nodes: [authored('erin', 11, 'Four')],
                },
              }),
            ],
          },
        }),
      ),
    );

    expect(cut.outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'comments truncated: the first 2 of 230',
        `replies truncated: the first 1 of 140 under ${SOURCE}#discussioncomment-7`,
      ],
    });
    const whole = await readDiscussion(
      data(
        discussion({
          comments: { totalCount: 1, nodes: [comment('bob', 7, 'One')] },
        }),
      ),
    );
    expect(whole.outcome).toMatchObject({ kind: 'rendered', notes: [] });
  });

  it('renders the discussion when GraphQL reports an error beside complete data', async () => {
    const { outcome } = await readDiscussion(
      response({
        data: { repository: { discussion: discussion() } },
        errors: [{ type: 'FORBIDDEN', message: 'ignored' }],
      }),
    );

    expect(outcome).toMatchObject({ kind: 'rendered', notes: [] });
  });

  it.each([
    ['a rate-limit error', response({ errors: [{ type: 'RATE_LIMITED' }] })],
    [
      'a rate-limit error beside null data',
      response({
        data: null,
        errors: [{ type: 'X' }, { type: 'RATE_LIMITED' }],
      }),
    ],
  ])('falls through with rate_limit on %s', async (_, reply) => {
    await expect(readDiscussion(reply)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'rate_limit' },
    });
  });

  it.each([
    ['a null discussion', data(null)],
    [
      'a missing discussion',
      response({
        data: { repository: { discussion: null } },
        errors: [{ type: 'NOT_FOUND' }],
      }),
    ],
    ['a null repository', response({ data: { repository: null } })],
    ['null data', response({ data: null, errors: [{ type: 'FORBIDDEN' }] })],
    ['an empty answer', response({})],
  ])('falls through with status on %s', async (_, reply) => {
    await expect(readDiscussion(reply)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
  });

  it.each([
    ['a payload missing required fields', data({ number: 5 })],
    [
      'a body that is not JSON',
      { finalUrl: GRAPHQL_URL, contentType: 'application/json', body: 'oops' },
    ],
  ])('falls through with parse on %s', async (_, reply) => {
    await expect(readDiscussion(reply)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'parse' },
    });
  });

  it('falls through on an HTTP status or rate limit and ends the read on an abort', async () => {
    await expect(readDiscussion(failure(401))).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      readDiscussion(failure(403, { remaining: '0', reset: '123' })),
    ).resolves.toMatchObject({
      outcome: {
        kind: 'failed',
        failure: 'rate_limit',
        reset: '1970-01-01T00:02:03.000Z',
      },
    });

    const aborted: WebFetchFailure = {
      type: 'aborted',
      message: 'The web read was cancelled.',
    };
    await expect(readDiscussion(aborted)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'transport', fatal: aborted },
    });
  });
});
