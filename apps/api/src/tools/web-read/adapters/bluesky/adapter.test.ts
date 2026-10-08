import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import type { WebAdapterOutcome } from '../contract';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createBlueskyAdapter } from './adapter';

const adapter = createBlueskyAdapter(
  { id: 'bluesky', use: 'bluesky' },
  { apiOrigin: API_ORIGIN },
);
const HIDDEN = [{ val: '!no-unauthenticated' }];

function author(handle: string, extra: JsonObject = {}): JsonObject {
  return { did: `did:plc:${handle.split('.')[0]}`, handle, ...extra };
}

function post(
  handle: string,
  rkey: string,
  text: string,
  extra: { readonly author?: JsonObject; readonly embed?: JsonObject } = {},
): JsonObject {
  return {
    uri: `at://did:plc:${handle.split('.')[0]}/app.bsky.feed.post/${rkey}`,
    author: author(handle, extra.author),
    record: { text, createdAt: `2026-10-01T00:00:0${rkey.length}Z` },
    ...(extra.embed !== undefined && { embed: extra.embed }),
  };
}

function node(postView: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post: postView,
    ...extra,
  };
}

function xrpc(method: string, params: Record<string, string>): string {
  return `${API_ORIGIN}/xrpc/${method}?${new URLSearchParams(params)}`;
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return {
    outcome,
    urls: run.requests.map(({ url }) => url),
    inits: run.requests.map(({ init }) => init),
  };
}

function contentOf(outcome: WebAdapterOutcome) {
  if (outcome.kind !== 'rendered') throw new Error(JSON.stringify(outcome));
  return outcome.content;
}

const THREAD_URL = xrpc('app.bsky.feed.getPostThread', {
  uri: 'at://alice.test/app.bsky.feed.post/p1',
});
const PROFILE_URL = xrpc('app.bsky.actor.getProfile', { actor: 'alice.test' });
const FEED_URL = xrpc('app.bsky.feed.getAuthorFeed', {
  actor: 'did:plc:alice',
  filter: 'posts_no_replies',
  limit: '30',
});

describe('Bluesky adapter claim', () => {
  it.each([
    'https://bsky.app/profile/alice.test',
    'https://bsky.app/profile/alice.test/post/3mx5e63uvns2d',
    'https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/post/3abc',
    'https://bsky.app/profile/alice.test/followers',
    'https://bsky.app/profile/alice.test/follows?x=1#y',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://bsky.app/profile/alice.test',
    'https://staging.bsky.app/profile/alice.test',
    'https://bsky.app:8443/profile/alice.test',
    'https://bsky.app/profile/alice.test/',
    'https://bsky.app/profile/localhost',
    'https://bsky.app/profile/alice.test/post/',
    'https://bsky.app/profile/alice.test/feed/whats-hot',
    'https://bsky.app/profile/alice.test/lists/abc',
    'https://bsky.app/search?q=llame',
    `https://bsky.app/profile/${Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.')}.test`,
    `https://bsky.app/profile/did:plc:${'a'.repeat(2041)}`,
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Bluesky adapter posts', () => {
  it('renders a thread in x.md order with labels, embeds, and links', async () => {
    const text = 'Read café notes at example.com/very… now';
    const start = Buffer.byteLength('Read café notes at ');
    const focal = {
      ...post('alice.test', 'p1', text, {
        author: { displayName: 'Alice' },
        embed: {
          $type: 'app.bsky.embed.recordWithMedia#view',
          media: {
            $type: 'app.bsky.embed.images#view',
            images: [
              {
                fullsize: 'https://cdn.test/full.jpg',
                alt: 'A [cat]\nsleeping',
              },
            ],
          },
          record: {
            record: {
              $type: 'app.bsky.embed.record#viewRecord',
              uri: 'at://did:plc:carol/app.bsky.feed.post/q1',
              author: author('carol.test', { displayName: 'Carol' }),
              value: { text: 'Quoted text' },
              embeds: [
                {
                  $type: 'app.bsky.embed.external#view',
                  external: {
                    uri: 'https://example.com/article',
                    title: 'Article',
                    description: 'About it',
                  },
                },
              ],
            },
          },
        },
      }),
      record: {
        text,
        createdAt: '2026-10-01T00:00:00Z',
        facets: [
          {
            index: {
              byteStart: start,
              byteEnd: start + Buffer.byteLength('example.com/very…'),
            },
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com/very/long',
              },
            ],
          },
        ],
      },
    };
    const thread = node(focal, {
      parent: node(post('root.test', 'r0', 'Root post'), {
        parent: node(
          post('hid.test', 'h0', 'Withheld', { author: { labels: HIDDEN } }),
          { parent: node(post('grand.test', 'g0', 'Above withheld')) },
        ),
      }),
      replies: [
        node(post('alice.test', 'p2', 'Self thread'), {
          replies: [node(post('bob.test', 'b2', 'Nested reply'))],
        }),
        node(
          post('dave.test', 'd1', 'Hidden', { author: { labels: HIDDEN } }),
          {
            replies: [node(post('erin.test', 'e1', 'Under hidden'))],
          },
        ),
        {
          $type: 'app.bsky.feed.defs#blockedPost',
          uri: 'at://y',
          blocked: true,
        },
      ],
    });

    const { outcome, urls, inits } = await read(
      'https://bsky.app/profile/alice.test/post/p1',
      [[THREAD_URL, response({ thread })]],
    );

    expect(urls).toStrictEqual([THREAD_URL]);
    expect(inits).toStrictEqual([{ accept: 'application/json' }]);
    expect(outcome).toMatchObject({ mediaType: 'text/markdown', notes: [] });
    expect(contentOf(outcome)).toBe(
      [
        '## Parent · 1/4 — @root.test',
        '',
        'Root post',
        '',
        'Source: https://bsky.app/profile/root.test/post/r0',
        'Date: 2026-10-01T00:00:02Z',
        '',
        '---',
        '',
        '## Post · 2/4 — Alice (@alice.test)',
        '',
        'Read café notes at [example.com/very…](https://example.com/very/long) now',
        '',
        '> ![A cat sleeping](https://cdn.test/full.jpg)',
        '',
        '> **Quoted post**',
        '>',
        '> **Carol** @carol.test',
        '> Quoted text',
        '> [Article](https://example.com/article)',
        '> About it',
        '> Source: https://bsky.app/profile/carol.test/post/q1',
        '',
        'Source: https://bsky.app/profile/alice.test/post/p1',
        'Date: 2026-10-01T00:00:00Z',
        '',
        '---',
        '',
        '## Thread · 3/4 — @alice.test',
        '',
        'Self thread',
        '',
        'Source: https://bsky.app/profile/alice.test/post/p2',
        'Date: 2026-10-01T00:00:02Z',
        '',
        '---',
        '',
        '## Reply · 4/4 — @bob.test',
        '',
        'Replying to @alice.test',
        '',
        'Nested reply',
        '',
        'Source: https://bsky.app/profile/bob.test/post/b2',
        'Date: 2026-10-01T00:00:02Z',
      ].join('\n'),
    );
  });

  it('renders video, unavailable quotes, and non-post records', async () => {
    const quote = (record: JsonObject) => ({
      $type: 'app.bsky.embed.record#view',
      record,
    });
    const thread = node(
      post('alice.test', 'p1', '', {
        embed: {
          $type: 'app.bsky.embed.video#view',
          playlist: 'https://video.test/playlist.m3u8',
          thumbnail: 'https://video.test/thumb.jpg',
        },
      }),
      {
        replies: [
          node(
            post('bob.test', 'b1', 'gone', {
              embed: quote({
                $type: 'app.bsky.embed.record#viewNotFound',
                uri: 'at://z',
                notFound: true,
              }),
            }),
          ),
          node(
            post('carol.test', 'c1', 'hidden', {
              embed: quote({
                $type: 'app.bsky.embed.record#viewRecord',
                uri: 'at://did:plc:dave/app.bsky.feed.post/d1',
                author: author('dave.test', { labels: HIDDEN }),
                value: { text: 'secret' },
              }),
            }),
          ),
          node(
            post('erin.test', 'e1', 'feed', {
              embed: quote({
                $type: 'app.bsky.feed.defs#generatorView',
                uri: 'at://did:plc:f/app.bsky.feed.generator/hot',
              }),
            }),
          ),
          node(
            post('fay.test', 'f1', 'future', {
              embed: { $type: 'app.bsky.embed.hologram#view', beam: true },
            }),
          ),
        ],
      },
    );

    const content = contentOf(
      (
        await read('https://bsky.app/profile/alice.test/post/p1', [
          [THREAD_URL, response({ thread })],
        ])
      ).outcome,
    );

    expect(content).toContain(
      '> [video](https://video.test/playlist.m3u8)\n> ![video thumbnail](https://video.test/thumb.jpg)\n\nSource:',
    );
    expect(content).toContain('gone\n\n> **Quoted post**\n>\n> Unavailable\n');
    expect(content).toContain(
      'hidden\n\n> **Quoted post**\n>\n> Unavailable\n',
    );
    expect(content).not.toContain('secret');
    expect(content).toContain(
      '> **Embedded record**\n>\n> at://did:plc:f/app.bsky.feed.generator/hot\n',
    );
    expect(content).toContain(
      'future\n\nSource: https://bsky.app/profile/fay.test/post/f1',
    );
  });

  it('withholds a post whose author opted out of logged-out visibility', async () => {
    const thread = node(
      post('alice.test', 'p1', 'secret', { author: { labels: HIDDEN } }),
    );

    const { outcome } = await read(
      'https://bsky.app/profile/alice.test/post/p1',
      [[THREAD_URL, response({ thread })]],
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
  });

  it('falls through on status, rate limit, and malformed thread payloads', async () => {
    const source = 'https://bsky.app/profile/alice.test/post/p1';
    const notFound: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 400',
      httpStatus: 400,
    };
    const limited: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 429',
      httpStatus: 429,
    };

    await expect(read(source, [[THREAD_URL, notFound]])).resolves.toMatchObject(
      {
        outcome: { kind: 'failed', failure: 'status' },
      },
    );
    await expect(read(source, [[THREAD_URL, limited]])).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'rate_limit' },
    });
    await expect(
      read(source, [[THREAD_URL, { ...response({}), body: 'not json' }]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });
});

describe('Bluesky adapter profiles', () => {
  const profile = author('alice.test', {
    displayName: 'Alice',
    description: 'Bio line',
    followersCount: 12_345,
    followsCount: 7,
    postsCount: 89,
  });
  const header = [
    '# [Alice (@alice.test)](https://bsky.app/profile/alice.test)',
    '',
    'Bio line',
    '',
    'Followers: 12,345 · Following: 7 · Posts: 89',
  ].join('\n');

  it('renders the profile and its own latest posts, without reposts', async () => {
    const feed: JsonObject = {
      feed: [
        { post: post('alice.test', 'p1', 'First\n\nline') },
        {
          post: post('bob.test', 'b1', 'Reposted'),
          reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
        },
        { post: post('alice.test', 'p2', 'Second') },
      ],
    };

    const { outcome, urls } = await read(
      'https://bsky.app/profile/alice.test',
      [
        [PROFILE_URL, response(profile)],
        [FEED_URL, response(feed)],
      ],
    );

    expect(urls).toStrictEqual([PROFILE_URL, FEED_URL]);
    expect(contentOf(outcome)).toBe(
      [
        header,
        '',
        '## Latest posts',
        '- [@alice.test](https://bsky.app/profile/alice.test): First line [Source](https://bsky.app/profile/alice.test/post/p1)',
        '- [@alice.test](https://bsky.app/profile/alice.test): Second [Source](https://bsky.app/profile/alice.test/post/p2)',
      ].join('\n'),
    );
  });

  it('keeps the profile with an omission note when its posts do not load', async () => {
    const limited: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 429',
      httpStatus: 429,
    };
    const deadline: WebFetchFailure = {
      type: 'call_timeout',
      message: 'deadline',
    };

    for (const [reply, note] of [
      [limited, 'posts omitted: rate_limit'],
      [deadline, 'posts omitted: transport'],
      [{ ...response({}), body: '{"feed":7}' }, 'posts omitted: parse'],
    ] as const) {
      const { outcome } = await read('https://bsky.app/profile/alice.test', [
        [PROFILE_URL, response(profile)],
        [FEED_URL, reply],
      ]);
      expect(outcome).toStrictEqual({
        kind: 'rendered',
        content: header,
        mediaType: 'text/markdown',
        notes: [note],
      });
    }
  });

  it('ends the call when the posts request hits a call-ending failure', async () => {
    const aborted: WebFetchFailure = { type: 'aborted', message: 'aborted' };

    const { outcome } = await read('https://bsky.app/profile/alice.test', [
      [PROFILE_URL, response(profile)],
      [FEED_URL, aborted],
    ]);

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
  });

  it('withholds an opted-out profile without requesting its posts', async () => {
    const { outcome, urls } = await read(
      'https://bsky.app/profile/alice.test',
      [[PROFILE_URL, response({ ...profile, labels: HIDDEN })]],
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
    expect(urls).toStrictEqual([PROFILE_URL]);
  });
});

describe('Bluesky adapter follow lists', () => {
  it.each([
    ['followers', 'app.bsky.graph.getFollowers', 'Followers of'],
    ['follows', 'app.bsky.graph.getFollows', 'Accounts followed by'],
  ] as const)(
    'renders /%s with hidden accounts skipped',
    async (list, method, title) => {
      const url = xrpc(method, { actor: 'alice.test', limit: '100' });
      const page = {
        subject: author('alice.test', { displayName: 'Alice' }),
        [list]: [
          author('bob.test', { displayName: 'Bob', description: 'Two\nlines' }),
          author('carol.test', { labels: HIDDEN }),
          author('handle.invalid', { did: 'did:plc:dan' }),
        ],
        cursor: 'next',
      };

      const { outcome } = await read(
        `https://bsky.app/profile/alice.test/${list}`,
        [[url, response(page)]],
      );

      expect(contentOf(outcome)).toBe(
        [
          `# ${title} [Alice (@alice.test)](https://bsky.app/profile/alice.test)`,
          '',
          '- [Bob (@bob.test)](https://bsky.app/profile/bob.test): Two lines',
          '- [@handle.invalid](https://bsky.app/profile/did:plc:dan)',
          '',
          'Showing the first 2; more are not loaded.',
        ].join('\n'),
      );
    },
  );

  it('withholds a list whose subject opted out of logged-out visibility', async () => {
    const url = xrpc('app.bsky.graph.getFollowers', {
      actor: 'alice.test',
      limit: '100',
    });
    const page = {
      subject: author('alice.test', { labels: HIDDEN }),
      followers: [author('bob.test')],
    };

    const { outcome } = await read(
      'https://bsky.app/profile/alice.test/followers',
      [[url, response(page)]],
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
  });
});
