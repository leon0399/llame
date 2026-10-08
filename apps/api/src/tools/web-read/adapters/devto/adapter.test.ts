import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createDevtoAdapter } from './adapter';

const adapter = createDevtoAdapter({ id: 'devto', use: 'devto' });
const ARTICLE_URL =
  'https://dev.to/lydiahallie/javascript-visualized-promises-5gke';
const API_URL =
  'https://dev.to/api/articles/lydiahallie/javascript-visualized-promises-5gke';

/** The single-article endpoint's shape, with the fields the adapter ignores. */
const article: JsonObject = {
  type_of: 'article',
  title: 'JavaScript Visualized: Promises & Async/Await',
  description: '  If you are here   in 2024\n(or later)  ',
  url: ARTICLE_URL,
  published_at: '2020-01-15T10:00:00Z',
  reading_time_minutes: 8,
  tag_list: 'javascript, webdev',
  tags: ['javascript', 'webdev'],
  body_markdown:
    '\r\nIntro.\r\n\r\n## Part one\r\n\r\n```js\r\nawait x;\r\n```\r\n\r\n',
  body_html: '<p>Intro.</p>',
  user: { name: 'Lydia Hallie', username: 'lydiahallie' },
};

async function read(
  routes: ReadonlyArray<[string, Reply]>,
  source = ARTICLE_URL,
) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

describe('dev.to adapter claim', () => {
  it.each([
    ARTICLE_URL,
    'https://dev.to/sylwia-lask/the-accidental-blogger-5a3f/',
    'https://dev.to/ender_minyard/full-stack-roadmap-2k12?utm_source=x#comments',
    'https://dev.to/ab/x',
    'https://dev.to/devteam/some-org-post-1',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://dev.to/ben/post-1abc',
    'https://www.dev.to/ben/post-1abc',
    'https://dev.to/correctover/series',
    'https://example.com/ben/post-1abc',
    'https://dev.to/',
    'https://dev.to/ben',
    'https://dev.to/search?q=promises',
    'https://dev.to/t/webdev',
    'https://dev.to/p/editor_guide',
    'https://dev.to/tag/webdev',
    'https://dev.to/top/week',
    'https://dev.to/page/about',
    'https://dev.to/feed/ben',
    'https://dev.to/api/articles',
    'https://dev.to/admin/users',
    'https://dev.to/dashboard/following',
    'https://dev.to/new/article',
    'https://dev.to/notifications/comments',
    'https://dev.to/readinglist/archive',
    'https://dev.to/settings/profile',
    'https://dev.to/users/search',
    'https://dev.to/ben/post-1abc/comments',
    'https://dev.to/ben/post-1abc/comments/1abc',
    'https://dev.to/ben/post.1abc',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('dev.to adapter read', () => {
  it('renders the article as Markdown with a metadata header', async () => {
    const { outcome, requests } = await read([[API_URL, response(article)]]);

    expect(requests).toStrictEqual([
      { url: API_URL, init: { accept: 'application/json' } },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# JavaScript Visualized: Promises & Async/Await',
        '',
        'If you are here in 2024 (or later)',
        '',
        'Author: Lydia Hallie',
        'Published: 2020-01-15T10:00:00Z',
        'Tags: javascript, webdev',
        `URL: ${ARTICLE_URL}`,
        '',
        'Intro.',
        '',
        '## Part one',
        '',
        '```js',
        'await x;',
        '```',
      ].join('\n'),
    });
  });

  it('requests the article the URL names, however it is spelled', async () => {
    const api = 'https://dev.to/api/articles/sylwia-lask/the-accidental-5a3f';

    const { requests } = await read(
      [[api, response(article)]],
      'https://dev.to/sylwia-lask/the-accidental-5a3f/?utm_source=x#top',
    );

    expect(requests.map(({ url }) => url)).toStrictEqual([api]);
  });

  it('leaves out the header lines an article has no value for', async () => {
    const bare: JsonObject = {
      title: 'Bare',
      url: ARTICLE_URL,
      body_markdown: 'Text',
      user: { name: 'Lydia Hallie' },
    };
    const content = [
      '# Bare',
      '',
      'Author: Lydia Hallie',
      `URL: ${ARTICLE_URL}`,
      '',
      'Text',
    ].join('\n');

    const nulls = await read([
      [API_URL, response({ ...bare, description: null, published_at: null })],
    ]);
    const blanks = await read([
      [API_URL, response({ ...bare, description: ' \n ', tags: [] })],
    ]);

    expect(nulls.outcome).toMatchObject({ kind: 'rendered', content });
    expect(blanks.outcome).toMatchObject({ kind: 'rendered', content });
  });

  it('falls through when the article cannot be read', async () => {
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
      read([[API_URL, response({ title: 'No body' })]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
    await expect(
      read([[API_URL, { ...response({}), body: 'not json' }]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });

  it('falls through as empty when the article has no body', async () => {
    const { outcome } = await read([
      [API_URL, response({ ...article, body_markdown: ' \r\n ' })],
    ]);

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
  });
});
