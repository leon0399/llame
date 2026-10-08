import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createHackernewsAdapter } from './adapter';

const adapter = createHackernewsAdapter(
  { id: 'hn', use: 'hackernews' },
  { apiOrigin: API_ORIGIN },
);
const ITEM_URL = `${API_ORIGIN}/api/v1/items/1`;

function item(
  id: number,
  author: string | null,
  children: ReadonlyArray<JsonObject> = [],
  extra: JsonObject = {},
): JsonObject {
  return {
    id,
    type: 'comment',
    author,
    title: null,
    url: null,
    text: author === null ? null : `<p>Comment ${id}</p>`,
    points: null,
    created_at: '2026-01-01T00:00:00.000Z',
    children,
    ...extra,
  };
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
}

describe('Hacker News adapter claim', () => {
  it.each([
    'https://news.ycombinator.com/item?id=8863',
    'https://news.ycombinator.com/item?id=8863&p=2',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://news.ycombinator.com/item?id=8863',
    'https://news.ycombinator.com/item',
    'https://news.ycombinator.com/item?id=0',
    'https://news.ycombinator.com/item?id=abc',
    'https://news.ycombinator.com/news',
    'https://news.ycombinator.com/user?id=pg',
    'https://hn.algolia.com/api/v1/items/8863',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Hacker News adapter read', () => {
  it('renders the story and its reply tree in the x.md thread layout', async () => {
    const story = item(
      1,
      'pg',
      [item(2, 'alice', [item(3, 'bob')]), item(4, 'carol')],
      {
        type: 'story',
        title: 'Show HN: A thing',
        url: 'https://example.com/thing',
        text: null,
        points: 42,
      },
    );

    const { outcome, urls } = await read(
      'https://news.ycombinator.com/item?id=1',
      [[ITEM_URL, response(story)]],
    );

    expect(urls).toStrictEqual([ITEM_URL]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '## Post · 1/4 — @pg',
        '',
        '**Show HN: A thing**',
        '',
        'Link: https://example.com/thing',
        '',
        'Points: 42',
        'Source: https://news.ycombinator.com/item?id=1',
        'Date: 2026-01-01T00:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 2/4 — @alice',
        '',
        'Comment 2',
        '',
        'Source: https://news.ycombinator.com/item?id=2',
        'Date: 2026-01-01T00:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 3/4 — @bob',
        '',
        'Replying to @alice',
        '',
        'Comment 3',
        '',
        'Source: https://news.ycombinator.com/item?id=3',
        'Date: 2026-01-01T00:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 4/4 — @carol',
        '',
        'Comment 4',
        '',
        'Source: https://news.ycombinator.com/item?id=4',
        'Date: 2026-01-01T00:00:00.000Z',
      ].join('\n'),
    });
  });

  it('omits an empty job link and falls through for polls', async () => {
    const job = item(1, 'acme', [], {
      type: 'job',
      title: 'Acme is hiring',
      url: '',
      text: '<p>Apply</p>',
    });

    const { outcome } = await read('https://news.ycombinator.com/item?id=1', [
      [ITEM_URL, response(job)],
    ]);

    expect(outcome.kind).toBe('rendered');
    if (outcome.kind !== 'rendered') throw new Error('expected render');
    expect(outcome.content).not.toContain('Link:');
    expect(outcome.content).toContain('Apply');
    await expect(
      read('https://news.ycombinator.com/item?id=1', [
        [ITEM_URL, response(item(1, 'pg', [], { type: 'poll' }))],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
    await expect(
      read('https://news.ycombinator.com/item?id=1', [
        [ITEM_URL, response(item(1, 'pg', [], { type: 'pollopt' }))],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });

  it('falls through for a missing item or a malformed payload', async () => {
    const notFound: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };

    await expect(
      read('https://news.ycombinator.com/item?id=1', [[ITEM_URL, notFound]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      read('https://news.ycombinator.com/item?id=1', [
        [ITEM_URL, response({ id: 1 })],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });
});
