import { describe, expect, it } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createLobstersAdapter } from './adapter';

const adapter = createLobstersAdapter(
  { id: 'lobsters', use: 'lobsters' },
  { origin: API_ORIGIN },
);

function storyUrl(shortId: string): string {
  return `${API_ORIGIN}/s/${shortId}.json`;
}

function comment(
  shortId: string,
  user: string | null,
  extra: JsonObject = {},
): JsonObject {
  return {
    short_id: shortId,
    parent_comment: null,
    score: 1,
    commenting_user: user,
    comment: `<p>Comment ${shortId}</p>`,
    created_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function story(extra: JsonObject = {}): JsonObject {
  return {
    short_id: 'o0ixth',
    title: 'Haxy.net is live!',
    url: 'https://example.com/video',
    description: '',
    score: 15,
    submitter_user: 'jeffective',
    tags: ['vcs', 'video'],
    comments: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
}

describe('Lobsters adapter claim', () => {
  it.each([
    'https://lobste.rs/s/o0ixth',
    'https://lobste.rs/s/o0ixth/haxy_net_is_live_haxy_git_forge_devlog',
    'https://lobste.rs/s/o0ixth?utm_source=x',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://lobste.rs/s/o0ixth',
    'https://lobste.rs:8443/s/o0ixth',
    'https://www.lobste.rs/s/o0ixth',
    'https://lobste.rs/s/',
    'https://lobste.rs/s/o0ixth/',
    'https://lobste.rs/s/o0ixth/one/two',
    'https://lobste.rs/s/o0ixth.json',
    'https://lobste.rs/s/O0IXTH',
    'https://lobste.rs/t/rust',
    'https://lobste.rs/c/telkxr',
    'https://example.com/s/o0ixth',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Lobsters adapter read', () => {
  it('renders the story and its comment thread in the x.md thread layout', async () => {
    const payload = story({
      comments: [
        comment('c00001', 'alice'),
        comment('c00002', 'bob', { parent_comment: 'c00001' }),
        comment('c00003', 'carol'),
      ],
    });

    const { outcome, urls } = await read(
      'https://lobste.rs/s/o0ixth/haxy_net_is_live_haxy_git_forge_devlog?utm_source=x',
      [[storyUrl('o0ixth'), response(payload)]],
    );

    expect(urls).toStrictEqual([storyUrl('o0ixth')]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '## Post · 1/4 — @jeffective',
        '',
        '**Haxy.net is live!**',
        '',
        'Link: https://example.com/video',
        '',
        'Tags: vcs, video',
        '',
        'Score: 15',
        'Source: https://lobste.rs/s/o0ixth',
        'Date: 2026-01-01T00:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 2/4 — @alice',
        '',
        'Comment c00001',
        '',
        'Score: 1',
        'Source: https://lobste.rs/c/c00001',
        'Date: 2026-01-01T00:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 3/4 — @bob',
        '',
        'Replying to @alice',
        '',
        'Comment c00002',
        '',
        'Score: 1',
        'Source: https://lobste.rs/c/c00002',
        'Date: 2026-01-01T00:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 4/4 — @carol',
        '',
        'Comment c00003',
        '',
        'Score: 1',
        'Source: https://lobste.rs/c/c00003',
        'Date: 2026-01-01T00:00:00.000Z',
      ].join('\n'),
    });
  });

  it('renders a text post without a Link and with its description', async () => {
    const payload = story({
      short_id: '7vzgsl',
      url: '',
      description: '<p>What are you doing this week? Feel free to share!</p>',
      tags: ['ask', 'programming'],
      submitter_user: 'caius',
    });

    const { outcome } = await read('https://lobste.rs/s/7vzgsl', [
      [storyUrl('7vzgsl'), response(payload)],
    ]);

    expect(outcome.kind).toBe('rendered');
    if (outcome.kind !== 'rendered') throw new Error('expected render');
    expect(outcome.content).not.toContain('Link:');
    expect(outcome.content).toContain(
      'What are you doing this week? Feel free to share!',
    );
    expect(outcome.content).toContain('Tags: ask, programming');
  });

  it('marks a missing commenter and omits a reply marker without its parent', async () => {
    const payload = story({
      comments: [
        comment('c00009', null, {
          parent_comment: 'missing',
          comment: null,
          score: 3,
        }),
      ],
    });

    const { outcome } = await read('https://lobste.rs/s/o0ixth', [
      [storyUrl('o0ixth'), response(payload)],
    ]);

    expect(outcome.kind).toBe('rendered');
    if (outcome.kind !== 'rendered') throw new Error('expected render');
    expect(outcome.content).toContain('## Reply · 2/2 — [deleted]');
    expect(outcome.content).not.toContain('Replying to');
    expect(outcome.content).not.toContain('Comment c00009');
    expect(outcome.content).toContain('Score: 3');
  });

  it('falls through for a missing story, a malformed payload, or a response that left lobste.rs', async () => {
    const notFound: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };

    await expect(
      read('https://lobste.rs/s/o0ixth', [[storyUrl('o0ixth'), notFound]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      read('https://lobste.rs/s/o0ixth', [
        [storyUrl('o0ixth'), response({ short_id: 'o0ixth' })],
      ]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'parse' },
    });

    const offOrigin: WebResponse = {
      ...response(story()),
      finalUrl: 'https://cdn.example/s/o0ixth.json',
    };
    await expect(
      read('https://lobste.rs/s/o0ixth', [[storyUrl('o0ixth'), offOrigin]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
  });
});
