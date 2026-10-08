import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createSubstackAdapter } from './adapter';

const adapter = createSubstackAdapter({ id: 'substack', use: 'substack' });
const POST_URL = 'https://simonw.substack.com/p/live-blog';
const API_URL = 'https://simonw.substack.com/api/v1/posts/live-blog';

/** A post body that starts with a non-breaking space, with Substack's captioned
 *  image block, an image the author linked elsewhere, links of every kind, and
 *  a code sample that shows a root-relative `href`. */
const BODY_HTML = [
  '<p>&nbsp;Intro with <a href="/p/other-post">another post</a> and ',
  '<a href="https://example.com/image-link-tips">tips</a>.</p>',
  '<div class="captioned-image-container"><figure>',
  '<a class="image-link image2 is-viewable-img" target="_blank" href="https://substackcdn.com/image/fetch/full.png" data-component-name="Image2ToDOM">',
  '<div class="image2-inset"><picture>',
  '<source type="image/webp" srcset="https://substackcdn.com/small.webp 424w">',
  '<img src="https://substackcdn.com/small.png" alt="A chart"></picture></div></a>',
  '<figcaption class="image-caption">Chart caption</figcaption></figure></div>',
  '<p><a class="image-link image2 is-viewable-img" href="https://example.com/shop">',
  '<img src="https://substackcdn.com/banner.png" alt="Shop"></a></p>',
  '<p><img src="/media/local.png" alt="local"> and ',
  '<img src="//cdn.example.com/p.png" alt="proto"></p>',
  '<pre><code>&lt;a href="/docs"&gt;docs&lt;/a&gt;</code></pre>',
].join('');

/** `GET /api/v1/posts/{slug}`, with a field the adapter ignores. */
const post: JsonObject = {
  id: 218_970_332,
  title: 'OpenAI DevDay live blog',
  subtitle: 'Plus hard budget caps',
  audience: 'everyone',
  canonical_url: POST_URL,
  post_date: '2026-10-05T17:16:45.944Z',
  publishedBylines: [
    { id: 1, name: 'Simon Willison', handle: 'simonw' },
    { id: 2, name: null },
    { id: 3, name: 'Axelle Malek' },
  ],
  postTags: [
    { name: 'openai', hidden: false },
    { name: 'sections', hidden: true },
    { name: 'llms' },
  ],
  body_html: BODY_HTML,
};

async function read(routes: ReadonlyArray<[string, Reply]>, source = POST_URL) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

describe('Substack adapter claim', () => {
  it.each([
    POST_URL,
    `${POST_URL}/`,
    `${POST_URL}?r=2abc&utm_campaign=post#footnote-1`,
    'https://experimental-history.substack.com/p/the-3-slug',
    'https://on.substack.com/p/x',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://simonw.substack.com/p/live-blog',
    'https://substack.com/p/live-blog',
    'https://www.substack.com/p/live-blog',
    'https://a.b.substack.com/p/live-blog',
    'https://-bad.substack.com/p/live-blog',
    'https://simonw.substack.com.example.com/p/live-blog',
    'https://simonwsubstack.com/p/live-blog',
    'https://example.com/p/live-blog',
    'https://open.substack.com/pub/simonw/p/live-blog',
    'https://simonw.substack.com/',
    'https://simonw.substack.com/archive',
    'https://simonw.substack.com/p/',
    'https://simonw.substack.com/p/live.blog',
    'https://simonw.substack.com/p/live-blog/comments',
    'https://simonw.substack.com/i/12345/live-blog',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Substack adapter read', () => {
  it('renders the post as Markdown with a metadata header', async () => {
    const { outcome, requests } = await read([[API_URL, response(post)]]);

    expect(requests).toStrictEqual([
      { url: API_URL, init: { accept: 'application/json' } },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# OpenAI DevDay live blog',
        '',
        'Plus hard budget caps',
        '',
        'Author: Simon Willison, Axelle Malek',
        'Published: 2026-10-05T17:16:45.944Z',
        'Tags: openai, llms',
        `URL: ${POST_URL}`,
        '',
        'Intro with [another post](https://simonw.substack.com/p/other-post) and [tips](https://example.com/image-link-tips).',
        '',
        '![A chart](https://substackcdn.com/small.png)',
        '',
        'Chart caption',
        '',
        '[![Shop](https://substackcdn.com/banner.png)](https://example.com/shop)',
        '',
        '![local](https://simonw.substack.com/media/local.png) and ![proto](//cdn.example.com/p.png)',
        '',
        '```',
        '<a href="/docs">docs</a>',
        '```',
      ].join('\n'),
    });
  });

  it('requests the post the URL names, however it is spelled', async () => {
    const api = 'https://on.substack.com/api/v1/posts/the-3-slug';

    const { requests } = await read(
      [[api, response(post)]],
      'https://on.substack.com/p/the-3-slug/?r=2abc#top',
    );

    expect(requests.map(({ url }) => url)).toStrictEqual([api]);
  });

  it.each(['only_paid', 'only_free', 'founding'])(
    'notes that a %s post carries only its preview',
    async (audience) => {
      const { outcome } = await read([
        [API_URL, response({ ...post, audience })],
      ]);

      expect(outcome).toMatchObject({
        kind: 'rendered',
        notes: ['body truncated: subscribers only'],
      });
    },
  );

  it('names the canonical address a custom domain gives the post', async () => {
    const canonical = 'https://www.simon-letters.com/p/live-blog';

    const { outcome } = await read([
      [API_URL, response({ ...post, canonical_url: canonical })],
    ]);

    expect(outcome.kind === 'rendered' && outcome.content).toContain(
      `\nURL: ${canonical}\n`,
    );
  });

  it('leaves out the header lines a post has no value for', async () => {
    const bare: JsonObject = {
      title: 'Bare',
      audience: 'everyone',
      canonical_url: POST_URL,
      body_html: '<p>Text</p>',
    };
    const content = ['# Bare', '', `URL: ${POST_URL}`, '', 'Text'].join('\n');

    const absent = await read([[API_URL, response(bare)]]);
    const empty = await read([
      [
        API_URL,
        response({
          ...bare,
          subtitle: '',
          post_date: null,
          publishedBylines: [{ name: null }],
          postTags: [{ name: 'hidden', hidden: true }],
        }),
      ],
    ]);

    expect(absent.outcome).toMatchObject({ kind: 'rendered', content });
    expect(empty.outcome).toMatchObject({ kind: 'rendered', content });
  });

  it('falls through when the post cannot be read', async () => {
    const missing: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };
    const throttled: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 429',
      httpStatus: 429,
    };

    await expect(read([[API_URL, missing]])).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(read([[API_URL, throttled]])).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'rate_limit' },
    });
  });

  it('ends the call on a call-ending failure', async () => {
    const aborted: WebFetchFailure = { type: 'aborted', message: 'aborted' };

    const { outcome } = await read([[API_URL, aborted]]);

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
  });

  it('falls through on a malformed payload', async () => {
    await expect(
      read([[API_URL, response({ title: 'No audience' })]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
    await expect(
      read([[API_URL, { ...response({}), body: 'not json' }]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });

  it.each([null, '', '<p></p>'])(
    'falls through as empty when the post body is %j',
    async (bodyHtml) => {
      const { outcome } = await read([
        [API_URL, response({ ...post, body_html: bodyHtml })],
      ]);

      expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
    },
  );
});
