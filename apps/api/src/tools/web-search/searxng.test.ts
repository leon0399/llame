import { describe, expect, it } from 'vitest';
import { createSearxngEngine } from './searxng';
import { type EngineRequest } from './chain';
import { captureFetch } from '../../testing/web-search-fetch';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'site:example.test latest adapters',
  recency: 'week',
  limit: 1,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  ...overrides,
});
type FixtureResult = {
  readonly title?: string | number;
  readonly url?: string | number;
  readonly content?: string | number;
  readonly publishedDate?: string | null;
};
type FixtureBody =
  | string
  | { readonly results: Array<FixtureResult> }
  | { readonly results: string };
function captureFixture(body: FixtureBody, status = 200) {
  return captureFetch(JSON.stringify(body), status);
}
const success = (results: Array<FixtureResult> = []): FixtureBody => ({
  results,
});

describe('SearXNG adapter', () => {
  it('keeps the base path and maps GET parameters and result fields', async () => {
    const recorded = captureFixture(
      success([
        {
          title: 'A result',
          url: 'https://example.test/a',
          content: 'A snippet',
          publishedDate: '2026-10-07T12:00:00Z',
        },
        { title: 'No content', url: 'https://example.test/b' },
        {
          title: 'Null date',
          url: 'https://example.test/c',
          publishedDate: null,
        },
        { title: 'Malformed', url: 3 },
      ]),
    );
    const result = await createSearxngEngine(
      { baseUrl: 'http://localhost:8888/searxng' },
      { fetch: recorded.fetch },
    )(request());
    const url = new URL(recorded.seen().url);
    expect(url.origin + url.pathname).toBe(
      'http://localhost:8888/searxng/search',
    );
    expect(url.searchParams.get('q')).toBe('site:example.test latest adapters');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('time_range')).toBe('month');
    expect(recorded.seen().init?.method).toBe('GET');
    const headers = new Headers(recorded.seen().init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('llame/test');
    expect(headers.get('authorization')).toBeNull();
    expect(result).toStrictEqual({
      kind: 'results',
      notes: ['SearXNG mapped week recency to month.'],
      results: [
        {
          title: 'A result',
          url: 'https://example.test/a',
          snippet: 'A snippet',
          published: '2026-10-07T12:00:00Z',
        },
        { title: 'No content', url: 'https://example.test/b' },
        { title: 'Null date', url: 'https://example.test/c' },
      ],
    });
  });

  it('keeps a trailing-slash base path', async () => {
    const recorded = captureFixture(success());
    await createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: recorded.fetch },
    )(request({ recency: undefined }));
    expect(new URL(recorded.seen().url).pathname).toBe('/search');
  });

  it.each([
    ['day', 'day'],
    ['week', 'month'],
    ['month', 'month'],
    ['year', 'year'],
  ] as const)('maps %s to SearXNG %s', async (recency, expected) => {
    const recorded = captureFixture(success());
    await createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: recorded.fetch },
    )(request({ query: 'plain', recency }));
    expect(new URL(recorded.seen().url).searchParams.get('time_range')).toBe(
      expected,
    );
  });

  it('returns an exact empty result without recency notes', async () => {
    const engine = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: captureFixture(success()).fetch },
    );
    await expect(
      engine(request({ query: 'plain', recency: undefined })),
    ).resolves.toStrictEqual({ kind: 'empty' });
  });

  it('returns an empty result with a week mapping note', async () => {
    const engine = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: captureFixture(success()).fetch },
    );
    await expect(engine(request())).resolves.toStrictEqual({
      kind: 'empty',
      notes: ['SearXNG mapped week recency to month.'],
    });
  });

  it('rejects a malformed envelope and skips malformed entries', async () => {
    const malformedEntry = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      {
        fetch: captureFixture(
          success([
            { title: 'valid', url: 'https://example.test/' },
            { title: 2 },
          ]),
        ).fetch,
      },
    );
    await expect(
      malformedEntry(request({ recency: undefined })),
    ).resolves.toStrictEqual({
      kind: 'results',
      results: [{ title: 'valid', url: 'https://example.test/' }],
    });
    const malformedEnvelope = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: captureFixture({ results: 'bad' }).fetch },
    );
    await expect(malformedEnvelope(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
  });

  it('classifies a bodyless SearXNG 403 as upstream error', async () => {
    const engine = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: () => Promise.resolve(new Response(null, { status: 403 })) },
    );
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
  });

  it.each([
    [401, 'auth'],
    [403, 'upstream_error'],
    [429, 'rate_limited'],
    [503, 'upstream_error'],
  ] as const)('classifies HTTP %s as %s', async (status, failureClass) => {
    const engine = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      { fetch: captureFixture('failure', status).fetch },
    );
    await expect(engine(request())).rejects.toMatchObject({ failureClass });
  });

  it('refuses redirects without following them', async () => {
    let requests = 0;
    const engine = createSearxngEngine(
      { baseUrl: 'http://localhost:8888/' },
      {
        fetch: () => {
          requests += 1;
          return Promise.resolve(
            new Response('', {
              status: 302,
              headers: { location: 'https://other.example/' },
            }),
          );
        },
      },
    );
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
    expect(requests).toBe(1);
  });
});
