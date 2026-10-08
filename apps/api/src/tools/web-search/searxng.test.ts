import { createSearxngEngine } from './searxng';
import { type EngineRequest } from './chain';
import { type VendorFetch } from './http';

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
const response = (
  body: FixtureBody,
  status = 200,
  headers: HeadersInit = { 'content-type': 'application/json' },
): Response => new Response(JSON.stringify(body), { status, headers });
const requestUrl = (input: RequestInfo | URL): string => {
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return input;
};
type Capture = { readonly url: string; readonly init?: RequestInit };
type CapturedFetch = {
  readonly fetch: VendorFetch;
  readonly seen: () => Capture;
};
function capture(body: FixtureBody, status = 200): CapturedFetch {
  let value: Capture = { url: '' };
  const fetch: VendorFetch = (input, init) => {
    value = { url: requestUrl(input), init };
    return Promise.resolve(response(body, status));
  };
  return { fetch, seen: () => value };
}
const success = (results: Array<FixtureResult> = []): FixtureBody => ({
  results,
});

it('keeps the base path and maps GET parameters and result fields', async () => {
  const recorded = capture(
    success([
      {
        title: 'A result',
        url: 'https://example.test/a',
        content: 'A snippet',
        publishedDate: '2026-10-07T12:00:00Z',
      },
      {
        title: 'Second',
        url: 'https://example.test/b',
        content: 'Second snippet',
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
  expect(result).toEqual({
    kind: 'results',
    notes: ['SearXNG mapped week recency to month.'],
    results: [
      {
        title: 'A result',
        url: 'https://example.test/a',
        snippet: 'A snippet',
        published: '2026-10-07T12:00:00Z',
      },
    ],
  });
});

it.each([
  ['day', 'day'],
  ['week', 'month'],
  ['month', 'month'],
  ['year', 'year'],
] as const)('maps %s to SearXNG %s', async (recency, expected) => {
  const recorded = capture(success());
  await createSearxngEngine(
    { baseUrl: 'http://localhost:8888/' },
    { fetch: recorded.fetch },
  )(request({ query: 'plain', recency }));
  expect(new URL(recorded.seen().url).searchParams.get('time_range')).toBe(
    expected,
  );
});

it('omits time range when recency is unset and slices locally', async () => {
  const recorded = capture(
    success([
      { title: 'one', url: 'https://example.test/1' },
      { title: 'two', url: 'https://example.test/2' },
    ]),
  );
  const result = await createSearxngEngine(
    { baseUrl: 'http://localhost:8888/' },
    { fetch: recorded.fetch },
  )(request({ query: 'plain', recency: undefined, limit: 1 }));
  const url = new URL(recorded.seen().url);
  expect(url.searchParams.get('time_range')).toBeNull();
  expect(result).toEqual({
    kind: 'results',
    results: [{ title: 'one', url: 'https://example.test/1' }],
  });
});

it('returns an empty result with a week mapping note', async () => {
  const engine = createSearxngEngine(
    { baseUrl: 'http://localhost:8888/' },
    { fetch: capture(success()).fetch },
  );
  await expect(engine(request())).resolves.toEqual({
    kind: 'empty',
    notes: ['SearXNG mapped week recency to month.'],
  });
});

it('rejects a malformed envelope and skips malformed entries', async () => {
  const malformedEntry = createSearxngEngine(
    { baseUrl: 'http://localhost:8888/' },
    {
      fetch: capture(
        success([
          { title: 'valid', url: 'https://example.test/' },
          { title: 2 },
        ]),
      ).fetch,
    },
  );
  await expect(
    malformedEntry(request({ recency: undefined })),
  ).resolves.toEqual({
    kind: 'results',
    results: [{ title: 'valid', url: 'https://example.test/' }],
  });
  const malformedEnvelope = createSearxngEngine(
    { baseUrl: 'http://localhost:8888/' },
    { fetch: capture({ results: 'bad' }).fetch },
  );
  await expect(malformedEnvelope(request())).rejects.toMatchObject({
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
    { fetch: capture('failure', status).fetch },
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
