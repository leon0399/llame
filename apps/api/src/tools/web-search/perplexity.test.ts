import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PERPLEXITY_SEARCH_URL, createPerplexityEngine } from './perplexity';
import { type EngineRequest } from './chain';
import { captureFetch } from './test-fetch';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'site:example.test -site:spam.test latest',
  recency: 'week',
  limit: 7,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  ...overrides,
});
type FixtureResult = {
  readonly title?: string | number;
  readonly url?: string | number;
  readonly snippet?: string | number;
  readonly date?: string | null;
};
type FixtureBody =
  | string
  | { readonly results: Array<FixtureResult> }
  | { readonly results: string };
const PerplexityRequestBodySchema = z.object({
  query: z.string(),
  max_results: z.number(),
  search_recency_filter: z.string().optional(),
  search_domain_filter: z.array(z.string()).optional(),
});
type PerplexityRequestBody = z.infer<typeof PerplexityRequestBodySchema>;
async function parseBody(
  init: RequestInit | undefined,
): Promise<PerplexityRequestBody> {
  const text = await new Response(init?.body ?? null).text();
  // SAFETY: The schema validates JSON parsed from the captured vendor request.
  return PerplexityRequestBodySchema.parse(JSON.parse(text) as unknown);
}
function captureFixture(body: FixtureBody, status = 200) {
  return captureFetch(JSON.stringify(body), status);
}
const success = (results: Array<FixtureResult> = []): FixtureBody => ({
  results,
});

describe('Perplexity adapter', () => {
  it('sends mixed domain filters in one-mode request and maps results', async () => {
    const recorded = captureFixture(
      success([
        {
          title: 'A result',
          url: 'https://example.test/a',
          snippet: 'A snippet',
          date: '2026-10-07',
        },
        {
          title: 'Null date',
          url: 'https://example.test/null',
          snippet: 'Null',
          date: null,
        },
        {
          title: 'Absent date',
          url: 'https://example.test/absent',
          snippet: 'Absent',
        },
        { title: 'Malformed', url: 'bad', snippet: 4 },
      ]),
    );
    const result = await createPerplexityEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request());
    expect(recorded.seen().url).toBe(PERPLEXITY_SEARCH_URL);
    expect(recorded.seen().init?.method).toBe('POST');
    const headers = new Headers(recorded.seen().init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('llame/test');
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: '-site:spam.test latest',
      max_results: 7,
      search_recency_filter: 'week',
      search_domain_filter: ['example.test'],
    });
    expect(result).toStrictEqual({
      kind: 'results',
      notes: ['Some site filters remained in the query.'],
      results: [
        {
          title: 'A result',
          url: 'https://example.test/a',
          snippet: 'A snippet',
          published: '2026-10-07',
        },
        {
          title: 'Null date',
          url: 'https://example.test/null',
          snippet: 'Null',
        },
        {
          title: 'Absent date',
          url: 'https://example.test/absent',
          snippet: 'Absent',
        },
      ],
    });
  });

  it('keeps an include-only result free of notes', async () => {
    const recorded = captureFixture(
      success([
        { title: 'Result', url: 'https://example.test/a', snippet: 'Snippet' },
      ]),
    );
    const result = await createPerplexityEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'site:example.test latest', recency: undefined }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'latest',
      max_results: 7,
      search_domain_filter: ['example.test'],
    });
    expect(result).toStrictEqual({
      kind: 'results',
      results: [
        { title: 'Result', url: 'https://example.test/a', snippet: 'Snippet' },
      ],
    });
  });

  it('keeps an operator-only query non-empty', async () => {
    const recorded = captureFixture(success());
    await createPerplexityEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'site:example.test', recency: undefined }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'site:example.test',
      max_results: 7,
      search_domain_filter: ['example.test'],
    });
  });

  it('maps only the first twenty denylist domains and leaves the rest in query', async () => {
    const filters = Array.from(
      { length: 21 },
      (_, index) => `-site:deny${index + 1}.test`,
    ).join(' ');
    const recorded = captureFixture(success());
    await createPerplexityEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: `${filters} latest` }));
    const body = await parseBody(recorded.seen().init);
    expect(body.search_domain_filter).toStrictEqual(
      Array.from({ length: 20 }, (_, index) => `-deny${index + 1}.test`),
    );
    expect(body.query).toBe('-site:deny21.test latest');
  });

  it('keeps mixed exclusions and over-cap includes in the query', async () => {
    const includes = Array.from(
      { length: 21 },
      (_, index) => `site:allow${index + 1}.test`,
    ).join(' ');
    const recorded = captureFixture(success());
    await createPerplexityEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: `${includes} -site:blocked.test latest` }));
    const body = await parseBody(recorded.seen().init);
    expect(body.search_domain_filter).toStrictEqual(
      Array.from({ length: 20 }, (_, index) => `allow${index + 1}.test`),
    );
    expect(body.query).toBe('site:allow21.test -site:blocked.test latest');
  });

  it.each(['day', 'week', 'month', 'year'] as const)(
    'maps %s recency',
    async (recency) => {
      const recorded = captureFixture(success());
      await createPerplexityEngine(
        { key: 'secret' },
        { fetch: recorded.fetch },
      )(request({ query: 'plain', recency }));
      expect(await parseBody(recorded.seen().init)).toMatchObject({
        search_recency_filter: recency,
      });
    },
  );

  it('omits recency and domains when absent', async () => {
    const recorded = captureFixture(success());
    await createPerplexityEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'plain', recency: undefined }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'plain',
      max_results: 7,
    });
  });

  it('reports stayed domain filters on an empty response', async () => {
    const overCap = Array.from(
      { length: 21 },
      (_, index) => `-site:deny${index}.test`,
    ).join(' ');
    const engine = createPerplexityEngine(
      { key: 'secret' },
      { fetch: captureFixture(success()).fetch },
    );
    await expect(engine(request({ query: overCap }))).resolves.toStrictEqual({
      kind: 'empty',
      notes: ['Some site filters remained in the query.'],
    });
  });

  it('returns empty for no valid results and rejects a malformed envelope', async () => {
    const empty = createPerplexityEngine(
      { key: 'secret' },
      { fetch: captureFixture(success([{ title: 'bad' }])).fetch },
    );
    await expect(empty(request({ query: 'plain' }))).resolves.toStrictEqual({
      kind: 'empty',
    });
    const malformed = createPerplexityEngine(
      { key: 'secret' },
      { fetch: captureFixture({ results: 'bad' }).fetch },
    );
    await expect(malformed(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [503, 'upstream_error'],
  ] as const)('classifies HTTP %s as %s', async (status, failureClass) => {
    const key = 'secret-key';
    const engine = createPerplexityEngine(
      { key },
      { fetch: captureFixture(`body ${key}`, status).fetch },
    );
    await expect(engine(request())).rejects.toMatchObject({ failureClass });
    await expect(engine(request())).rejects.not.toThrow(key);
  });
});
