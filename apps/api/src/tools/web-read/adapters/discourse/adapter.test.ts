import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import type { WebAdapterOutcome } from '../contract';
import { createDiscourseAdapter } from './adapter';

const HOST = 'forum.example.test';
const ORIGIN = `https://${HOST}`;
const adapter = createDiscourseAdapter({
  id: 'forum',
  use: 'discourse',
  hosts: [HOST, 'help.example.test'],
});
const TOPIC_URL = `${ORIGIN}/t/12.json`;
const TOPIC_PAGE = `${ORIGIN}/t/welcome-hello/12`;
const JSON_INIT = { accept: 'application/json' };
const DATE = '2026-01-01T00:00:00.000Z';

function post(number: number, extra: JsonObject = {}): JsonObject {
  return {
    id: 1000 + number,
    post_number: number,
    username: `user${number}`,
    name: null,
    created_at: DATE,
    cooked: `<p>Post ${number}</p>`,
    reply_to_post_number: null,
    ...extra,
  };
}

function topic(
  posts: ReadonlyArray<JsonObject>,
  stream?: ReadonlyArray<number>,
  extra: JsonObject = {},
): JsonObject {
  return {
    id: 12,
    title: 'Welcome & hello',
    slug: 'welcome-hello',
    posts_count: stream?.length ?? posts.length,
    post_stream: stream === undefined ? { posts } : { posts, stream },
    ...extra,
  };
}

/** The ids of posts `from` to `to`, as `post` numbers them. */
function ids(from: number, to: number): Array<number> {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => 1000 + from + index,
  );
}

function posts(from: number, to: number): Array<JsonObject> {
  return Array.from({ length: to - from + 1 }, (_, index) =>
    post(from + index),
  );
}

function chunkUrl(chunk: ReadonlyArray<number>): string {
  return `${ORIGIN}/t/12/posts.json?${chunk.map((id) => `post_ids[]=${id}`).join('&')}`;
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

function contentOf(outcome: WebAdapterOutcome): string {
  if (outcome.kind !== 'rendered') throw new Error('expected a render');
  return outcome.content;
}

function headings(outcome: WebAdapterOutcome): Array<string> {
  return contentOf(outcome)
    .split('\n')
    .filter((line) => line.startsWith('## '));
}

describe('Discourse adapter claim', () => {
  it.each([
    TOPIC_PAGE,
    `${TOPIC_PAGE}/3`,
    `${TOPIC_PAGE}/`,
    `${TOPIC_PAGE}?u=alice#post_3`,
    `${ORIGIN}/t/12`,
    `${ORIGIN}/t/12/3`,
    `${ORIGIN}/t/-/12`,
    `${ORIGIN}/t/%E6%AC%A2%E8%BF%8E/12/3`,
    `${ORIGIN}/t/2024-recap/12`,
    `${ORIGIN}/t/2024/12`,
    `${ORIGIN}/t/welcome-hello/5`,
    `${ORIGIN}/t/welcome-hello/123456789012`,
    `${ORIGIN}/t/welcome-hello/12/9999999999`,
    `${ORIGIN}:443/t/welcome-hello/12`,
    'https://help.example.test/t/welcome-hello/12',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    `http://${HOST}/t/welcome-hello/12`,
    'https://other.example.test/t/welcome-hello/12',
    `https://www.${HOST}/t/welcome-hello/12`,
    'https://example.test/t/welcome-hello/12',
    `${ORIGIN}:8443/t/welcome-hello/12`,
    `${ORIGIN}/`,
    `${ORIGIN}/t`,
    `${ORIGIN}/t/`,
    `${ORIGIN}/t/welcome-hello`,
    `${ORIGIN}/t/welcome-hello/abc`,
    `${ORIGIN}/t/welcome-hello/0`,
    `${ORIGIN}/t/welcome-hello/012`,
    `${ORIGIN}/t/welcome-hello/1234567890123`,
    `${ORIGIN}/t/welcome-hello/12/12345678901`,
    `${ORIGIN}/t/0`,
    `${ORIGIN}/t/welcome-hello/12/last`,
    `${ORIGIN}/t/welcome-hello/12/3/4`,
    `${ORIGIN}/t/12/3/4`,
    `${ORIGIN}/t/a/b/12`,
    `${ORIGIN}/t/12.json`,
    `${ORIGIN}/t/welcome-hello/12.json`,
    `${ORIGIN}/t/12/posts.json`,
    `${ORIGIN}/raw/12`,
    `${ORIGIN}/c/general/4`,
    `${ORIGIN}/latest`,
    `${ORIGIN}/u/alice`,
    `${ORIGIN}/forum/t/welcome-hello/12`,
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });

  it('claims nothing for an entry with no hosts', () => {
    const unconfigured = createDiscourseAdapter({
      id: 'forum',
      use: 'discourse',
      hosts: [],
    });

    expect(unconfigured.match(new URL(TOPIC_PAGE))).toBe(false);
  });

  it('is a native adapter named by its entry', () => {
    expect(adapter).toMatchObject({ id: 'forum', route: 'native' });
  });
});

describe('Discourse adapter read', () => {
  it('renders a topic in the x.md thread layout', async () => {
    const thread = [
      post(1, {
        username: 'alice',
        name: 'Alice Liddell',
        cooked:
          '<p>Welcome <a href="/u/bob">@bob</a>! See <a href="/t/other/7">this</a>.</p>',
        created_at: '2026-01-01T10:00:00.000Z',
      }),
      post(2, {
        username: 'bob',
        name: 'Bob',
        cooked: '<p>Thanks!</p>',
        reply_to_post_number: 1,
        created_at: '2026-01-01T11:00:00.000Z',
      }),
      post(3, {
        username: 'carol',
        name: '  ',
        cooked: '<pre><code>let x = 1;\n</code></pre>',
        reply_to_post_number: 2,
        created_at: '2026-01-01T12:00:00.000Z',
      }),
      post(4, {
        username: 'dave',
        name: 'Dave D.',
        cooked: '<p>Agreed</p>',
        reply_to_post_number: 3,
        created_at: '2026-01-01T13:00:00.000Z',
      }),
    ];

    const { outcome, requests } = await read(`${TOPIC_PAGE}/3?u=carol`, [
      [TOPIC_URL, response(topic(thread, [1001, 1002, 1003, 1004]))],
    ]);

    expect(requests).toStrictEqual([{ url: TOPIC_URL, init: JSON_INIT }]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '## Post · 1/4 — Alice Liddell (@alice)',
        '',
        '**Welcome & hello**',
        '',
        `Welcome [@bob](${ORIGIN}/u/bob)! See [this](${ORIGIN}/t/other/7).`,
        '',
        `Source: ${TOPIC_PAGE}/1`,
        'Date: 2026-01-01T10:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 2/4 — @bob',
        '',
        'Thanks!',
        '',
        `Source: ${TOPIC_PAGE}/2`,
        'Date: 2026-01-01T11:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 3/4 — @carol',
        '',
        'Replying to @bob',
        '',
        '```\nlet x = 1;\n```',
        '',
        `Source: ${TOPIC_PAGE}/3`,
        'Date: 2026-01-01T12:00:00.000Z',
        '',
        '---',
        '',
        '## Reply · 4/4 — Dave D. (@dave)',
        '',
        'Replying to @carol',
        '',
        'Agreed',
        '',
        `Source: ${TOPIC_PAGE}/4`,
        'Date: 2026-01-01T13:00:00.000Z',
      ].join('\n'),
    });
  });

  it.each([
    [`${TOPIC_PAGE}/3`, '12'],
    [`${ORIGIN}/t/12`, '12'],
    [`${ORIGIN}/t/12/3`, '12'],
    [`${ORIGIN}/t/-/12`, '12'],
    [`${ORIGIN}/t/2024-recap/7`, '7'],
    // Discourse routes two numbers as topic and post number.
    [`${ORIGIN}/t/2024/12`, '2024'],
  ])('requests the topic that %s names', async (source, topicId) => {
    const { requests } = await read(source, [
      [`${ORIGIN}/t/${topicId}.json`, response(topic(posts(1, 1), [1001]))],
    ]);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${ORIGIN}/t/${topicId}.json`,
    ]);
  });

  it.each([
    ['Alice Liddell', 'alice', 'Alice Liddell (@alice)'],
    ['Bob', 'bob', '@bob'],
    ['bob', 'Bob', '@Bob'],
    ['  ', 'carol', '@carol'],
    ['', 'dave', '@dave'],
    [null, 'erin', '@erin'],
    [' Frank F. ', 'frank', 'Frank F. (@frank)'],
  ])('labels the author %j of @%s as %s', async (name, username, label) => {
    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic([post(1, { name, username })], [1001]))],
    ]);

    expect(headings(outcome)).toStrictEqual([`## Post · 1/1 — ${label}`]);
  });

  it('reads the rest of a long topic by id and cuts it at 200 posts', async () => {
    const first = ids(21, 120);
    const second = ids(121, 200);

    const { outcome, requests } = await read(TOPIC_PAGE, [
      [
        TOPIC_URL,
        // The stream lists every post, so its length is the total, not `posts_count`.
        response(topic(posts(1, 20), ids(1, 481), { posts_count: 480 })),
      ],
      [chunkUrl(first), response({ post_stream: { posts: posts(21, 120) } })],
      // Posts are rendered in stream order, whatever order a page lists them.
      [
        chunkUrl(second),
        response({ post_stream: { posts: posts(121, 200).reverse() } }),
      ],
    ]);

    expect(requests).toStrictEqual([
      { url: TOPIC_URL, init: JSON_INIT },
      { url: chunkUrl(first), init: JSON_INIT },
      { url: chunkUrl(second), init: JSON_INIT },
    ]);
    expect(headings(outcome)).toStrictEqual(
      Array.from({ length: 200 }, (_, index) => {
        const label = index === 0 ? 'Post' : 'Reply';
        return `## ${label} · ${index + 1}/200 — @user${index + 1}`;
      }),
    );
    expect(contentOf(outcome)).toContain(`Source: ${TOPIC_PAGE}/200\n`);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['posts truncated: the first 200 of 481'],
    });
  });

  it('requests only the posts the topic response did not carry', async () => {
    const { outcome, requests } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 22)))],
      [
        chunkUrl([1021, 1022]),
        response({ post_stream: { posts: posts(21, 22) } }),
      ],
    ]);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      TOPIC_URL,
      `${ORIGIN}/t/12/posts.json?post_ids[]=1021&post_ids[]=1022`,
    ]);
    expect(outcome).toMatchObject({ kind: 'rendered', notes: [] });
    expect(headings(outcome)).toHaveLength(22);
  });

  it('skips a post the posts request did not return', async () => {
    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 22)))],
      [
        chunkUrl([1021, 1022]),
        response({ post_stream: { posts: [post(22)] } }),
      ],
    ]);

    expect(headings(outcome).at(-1)).toBe('## Reply · 21/21 — @user22');
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['posts truncated: the first 21 of 22'],
    });
  });

  it('keeps the posts before a request that fails and stops there', async () => {
    const first = ids(21, 120);
    const second = ids(121, 200);
    const throttled: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 429',
      httpStatus: 429,
    };

    // The second page is not scripted: asking for it fails the read.
    const early = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 250)))],
      [chunkUrl(first), throttled],
    ]);
    const late = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 250)))],
      [chunkUrl(first), response({ post_stream: { posts: posts(21, 120) } })],
      [chunkUrl(second), throttled],
    ]);

    expect(early.outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'posts omitted: rate_limit',
        'posts truncated: the first 20 of 250',
      ],
    });
    expect(headings(early.outcome)).toHaveLength(20);
    expect(late.outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'posts omitted: rate_limit',
        'posts truncated: the first 120 of 250',
      ],
    });
    expect(headings(late.outcome)).toHaveLength(120);
  });

  it('notes a posts page it cannot parse and stops there', async () => {
    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 250)))],
      [chunkUrl(ids(21, 120)), response({ post_stream: {} })],
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['posts omitted: parse', 'posts truncated: the first 20 of 250'],
    });
  });

  it('keeps the posts read when the call deadline is spent', async () => {
    const deadline: WebFetchFailure = { type: 'call_timeout', message: 'late' };

    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 250)))],
      [chunkUrl(ids(21, 120)), deadline],
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'posts omitted: transport',
        'posts truncated: the first 20 of 250',
      ],
    });
  });

  it('ends the call when a later request hits a call-ending failure', async () => {
    const aborted: WebFetchFailure = { type: 'aborted', message: 'aborted' };

    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(posts(1, 20), ids(1, 250)))],
      [chunkUrl(ids(21, 120)), aborted],
    ]);

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
  });

  it('renders the first page of a topic too large to list its posts', async () => {
    const { outcome, requests } = await read(TOPIC_PAGE, [
      [
        TOPIC_URL,
        response(topic(posts(1, 2), undefined, { posts_count: 12_345 })),
      ],
    ]);

    expect(requests).toHaveLength(1);
    expect(headings(outcome)).toStrictEqual([
      '## Post · 1/2 — @user1',
      '## Reply · 2/2 — @user2',
    ]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['posts truncated: the first 2 of 12345'],
    });
  });

  it('names a deleted account and a reply target that did not load', async () => {
    const thread = [
      post(1),
      post(2, { username: null, name: 'Ghost' }),
      post(3, { reply_to_post_number: 2 }),
      post(4, { reply_to_post_number: 9 }),
    ];

    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(thread, ids(1, 4)))],
    ]);

    const content = contentOf(outcome);
    expect(content).toContain('## Reply · 2/4 — [deleted]\n');
    expect(content).toContain(
      '## Reply · 3/4 — @user3\n\nReplying to post #2\n',
    );
    expect(content).toContain(
      '## Reply · 4/4 — @user4\n\nReplying to post #9\n',
    );
  });

  it('renders a small action by its text or else its event name', async () => {
    const thread = [
      post(1),
      post(2, {
        cooked:
          '<p>2 posts were split to a new topic: <a href="/t/x/9">X</a></p>',
        action_code: 'split_topic',
      }),
      post(3, { cooked: '', action_code: 'closed.enabled' }),
      post(4, { cooked: '' }),
    ];

    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic(thread, ids(1, 4)))],
    ]);

    const content = contentOf(outcome);
    expect(content).toContain(
      `2 posts were split to a new topic: [X](${ORIGIN}/t/x/9)\n`,
    );
    expect(content).not.toContain('`split_topic`');
    expect(content).toContain(
      '## Reply · 3/4 — @user3\n\n`closed.enabled`\n\n',
    );
    expect(content).toContain('## Reply · 4/4 — @user4\n\nSource:');
  });

  it('resolves root-relative links in tags but not in code samples', async () => {
    const linked = post(1, {
      cooked: [
        '<p><a class="mention" href="/u/bob">@bob</a>',
        '<img alt="a" src="/uploads/a.png">',
        '<img src="//cdn.example.test/b.png" alt="b">',
        '<a href="https://other.example.test/c">c</a></p>',
        '<pre><code>&lt;a href="/docs"&gt;docs&lt;/a&gt;\n</code></pre>',
      ].join(' '),
    });

    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic([linked], [1001]))],
    ]);

    expect(contentOf(outcome)).toContain(
      [
        `[@bob](${ORIGIN}/u/bob) ![a](${ORIGIN}/uploads/a.png) ![b](//cdn.example.test/b.png) [c](https://other.example.test/c)`,
        '',
        '```',
        '<a href="/docs">docs</a>',
        '```',
      ].join('\n'),
    );
  });

  it('drops the empty anchor that opens a heading but keeps a labelled one', async () => {
    const headed = post(1, {
      cooked: [
        '<h3><a name="p-1001-usage-1" class="anchor" href="#p-1001-usage-1"></a>Usage</h3>',
        '<p>Back to <a href="#top">the top</a></p>',
      ].join('\n'),
    });

    const { outcome } = await read(TOPIC_PAGE, [
      [TOPIC_URL, response(topic([headed], [1001]))],
    ]);

    expect(contentOf(outcome)).toContain(
      '### Usage\n\nBack to [the top](#top)\n',
    );
  });

  it('trims the no-break space a body can open with', async () => {
    const { outcome } = await read(TOPIC_PAGE, [
      [
        TOPIC_URL,
        response(topic([post(1, { cooked: '<p>&nbsp;Hello</p>' })], [1001])),
      ],
    ]);

    expect(contentOf(outcome)).toContain('**Welcome & hello**\n\nHello\n\n');
  });

  it.each([[''], [null]])(
    'links posts under /t/- when the slug is %j',
    async (slug) => {
      const { outcome } = await read(TOPIC_PAGE, [
        [TOPIC_URL, response(topic(posts(1, 1), [1001], { slug }))],
      ]);

      expect(contentOf(outcome)).toContain(`Source: ${ORIGIN}/t/-/12/1\n`);
    },
  );
});

describe('Discourse adapter fall-through', () => {
  it.each([403, 404])(
    'falls through for a topic answering HTTP %i',
    async (status) => {
      const refused: WebFetchFailure = {
        type: 'http_status',
        message: `HTTP ${status}`,
        httpStatus: status,
      };

      await expect(
        read(TOPIC_PAGE, [[TOPIC_URL, refused]]),
      ).resolves.toMatchObject({
        outcome: { kind: 'failed', failure: 'status' },
      });
    },
  );

  it('ends the call when the topic request hits a call-ending failure', async () => {
    const deadline: WebFetchFailure = { type: 'call_timeout', message: 'late' };

    await expect(
      read(TOPIC_PAGE, [[TOPIC_URL, deadline]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'transport', fatal: deadline },
    });
  });

  it('falls through for a response that is not a topic', async () => {
    const page = {
      ...response({}),
      body: '<!doctype html><title>Login</title>',
    };

    await expect(read(TOPIC_PAGE, [[TOPIC_URL, page]])).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'parse' },
    });
    await expect(
      read(TOPIC_PAGE, [[TOPIC_URL, response({ errors: ['nope'] })]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });

  it('falls through as empty for a topic with no posts', async () => {
    await expect(
      read(TOPIC_PAGE, [[TOPIC_URL, response(topic([], []))]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'empty' } });
  });
});
