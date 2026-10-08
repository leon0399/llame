import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createStackexchangeAdapter } from './adapter';

const adapter = createStackexchangeAdapter(
  { id: 'se', use: 'stackexchange' },
  { apiOrigin: API_ORIGIN },
);
const QUESTION_URL = `${API_ORIGIN}/2.3/questions/42?site=stackoverflow.com&filter=withbody`;
const ANSWERS_URL = `${API_ORIGIN}/2.3/questions/42/answers?site=stackoverflow.com&filter=withbody&sort=votes&order=desc&pagesize=100`;
const LINK = 'https://stackoverflow.com/questions/42/why-is-it-faster';

const question: JsonObject = {
  question_id: 42,
  title: 'Why is &quot;sorted&quot; faster?',
  body: '<p>Loop over <code>data</code>:</p><pre><code>for (;;) {}\n</code></pre>',
  link: LINK,
  score: 27_546,
  answer_count: 2,
  view_count: 2_004_504,
  tags: ['java', 'performance'],
  owner: { display_name: 'A &amp; B' },
  creation_date: 1_340_805_096,
  content_license: 'CC BY-SA 4.0',
};

function answer(id: number, score: number, accepted: boolean): JsonObject {
  return {
    answer_id: id,
    body: `<p>Answer ${id}</p>`,
    score,
    is_accepted: accepted,
    owner: { display_name: `user ${id}` },
    creation_date: 1_340_805_402,
  };
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
}

describe('Stack Exchange adapter claim', () => {
  it.each([
    'https://stackoverflow.com/questions/42',
    'https://stackoverflow.com/questions/42/why-is-it-faster?noredirect=1',
    'https://www.stackoverflow.com/q/42/7',
    'https://stackoverflow.com/a/43/7',
    'https://unix.stackexchange.com/questions/1/dd',
    'https://superuser.com/questions/5',
    'https://mathoverflow.net/q/9',
    'https://ru.stackoverflow.com/questions/5',
    'https://meta.stackexchange.com/questions/7',
    'https://stackoverflow.com/questions/42/why-is-it-faster/43',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://stackoverflow.com/questions/42',
    'https://stackoverflow.com/questions',
    'https://stackoverflow.com/questions/tagged/java',
    'https://stackoverflow.com/users/87234/x',
    'https://stackoverflow.com/questions/42/slug/extra',
    'https://stackoverflow.com/questions/42/slug/43/more',
    'https://example.stackexchange.org/questions/1',
    'https://stackexchange.com/questions/1',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Stack Exchange adapter read', () => {
  it('renders the question and answers with the accepted answer first', async () => {
    const { outcome, urls } = await read(LINK, [
      [QUESTION_URL, response({ items: [question] })],
      [
        ANSWERS_URL,
        response({
          items: [answer(44, 900, false), answer(43, 500, true)],
          has_more: false,
        }),
      ],
    ]);

    expect(urls).toStrictEqual([QUESTION_URL, ANSWERS_URL]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Why is "sorted" faster?',
        '',
        'Score: 27,546 · Answers: 2 · Views: 2,004,504',
        'Tags: java, performance',
        'Asked: 2012-06-27T13:51:36.000Z by A & B',
        'License: CC BY-SA 4.0',
        `URL: ${LINK}`,
        '',
        '## Question',
        '',
        'Loop over `data`:',
        '',
        '```\nfor (;;) {}\n```',
        '',
        '---',
        '',
        '## Answer · 1/2 — accepted · score 500 — user 43',
        '',
        'Answer 43',
        '',
        'Source: https://stackoverflow.com/a/43',
        'Date: 2012-06-27T13:56:42.000Z',
        '',
        '---',
        '',
        '## Answer · 2/2 — score 900 — user 44',
        '',
        'Answer 44',
        '',
        'Source: https://stackoverflow.com/a/44',
        'Date: 2012-06-27T13:56:42.000Z',
      ].join('\n'),
    });
  });

  it('resolves an answer link to its question on the same site', async () => {
    const lookup = `${API_ORIGIN}/2.3/answers/43?site=unix.stackexchange.com`;
    const unixQuestion = `${API_ORIGIN}/2.3/questions/42?site=unix.stackexchange.com&filter=withbody`;
    const unixAnswers = `${API_ORIGIN}/2.3/questions/42/answers?site=unix.stackexchange.com&filter=withbody&sort=votes&order=desc&pagesize=100`;

    const { outcome, urls } = await read(
      'https://unix.stackexchange.com/a/43',
      [
        [lookup, response({ items: [{ question_id: 42 }] })],
        [unixQuestion, response({ items: [question] })],
        [unixAnswers, response({ items: [], has_more: true })],
      ],
    );

    expect(urls).toStrictEqual([lookup, unixQuestion, unixAnswers]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['answers truncated: the first 100 by score'],
    });
  });

  it('reads a /q/ link that names an answer through its question', async () => {
    const asQuestion = `${API_ORIGIN}/2.3/questions/43?site=stackoverflow.com&filter=withbody`;
    const lookup = `${API_ORIGIN}/2.3/answers/43?site=stackoverflow.com`;

    const { outcome, urls } = await read('https://stackoverflow.com/q/43', [
      [asQuestion, response({ items: [] })],
      [lookup, response({ items: [{ question_id: 42 }] })],
      [QUESTION_URL, response({ items: [question] })],
      [ANSWERS_URL, response({ items: [] })],
    ]);

    expect(urls).toStrictEqual([asQuestion, lookup, QUESTION_URL, ANSWERS_URL]);
    expect(outcome).toMatchObject({ kind: 'rendered' });
  });

  it('resolves root-relative links in post bodies against the site', async () => {
    const linked = {
      ...question,
      body: '<p>See <a href="/u/7">this user</a> and <img src="//i.sstatic.net/x.png" alt="x"></p>',
    };

    const { outcome } = await read(LINK, [
      [QUESTION_URL, response({ items: [linked] })],
      [ANSWERS_URL, response({ items: [] })],
    ]);

    expect(outcome.kind === 'rendered' && outcome.content).toContain(
      'See [this user](https://stackoverflow.com/u/7) and ![x](//i.sstatic.net/x.png)',
    );
  });

  it('keeps the question with a note when the answers do not load', async () => {
    // The API reports quota and throttling as HTTP 400 with an error_id.
    const throttled: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 400',
      httpStatus: 400,
    };

    const { outcome } = await read(LINK, [
      [QUESTION_URL, response({ items: [question] })],
      [ANSWERS_URL, throttled],
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['answers omitted: status'],
    });
  });

  it('falls through as empty when an answer link names a deleted answer', async () => {
    const lookup = `${API_ORIGIN}/2.3/answers/43?site=stackoverflow.com`;

    const { outcome } = await read('https://stackoverflow.com/a/43', [
      [lookup, response({ items: [] })],
    ]);

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
  });

  it('falls through on a deleted question or a malformed payload', async () => {
    await expect(
      read(LINK, [[QUESTION_URL, response({ items: [] })]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'empty' } });
    await expect(
      read(LINK, [[QUESTION_URL, response({ items: [{ question_id: 42 }] })]]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });
});
