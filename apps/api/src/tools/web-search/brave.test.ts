import { BRAVE_SEARCH_URL, createBraveEngine } from './brave';
import { EngineFailure, type EngineRequest } from './chain';
import { type VendorFetch } from './http';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'site:example.test "quoted"',
  recency: 'week',
  limit: 7,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  ...overrides,
});
type BraveFixturePayload = {
  readonly web: { readonly results: ReadonlyArray<Record<string, string>> };
};
const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof URL
    ? input.href
    : input instanceof Request
      ? input.url
      : input;
const response = (
  body: BraveFixturePayload,
  status = 200,
  headers: HeadersInit = { 'content-type': 'application/json' },
): Response => new Response(JSON.stringify(body), { status, headers });
const emptyResponse = (): Response => response({ web: { results: [] } });

it('maps query, limit, freshness, headers, and HTML descriptions', async () => {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const fetch: VendorFetch = (input, init) => {
    seenUrl = requestUrl(input);
    seenInit = init;
    return Promise.resolve(
      response({
        web: {
          results: [
            {
              title: 'A result',
              url: 'https://example.test/a',
              description: '<b>A &amp; useful</b> result',
              page_age: '2026-01-01T00:00:00Z',
            },
          ],
        },
      }),
    );
  };
  const result = await createBraveEngine(
    { key: 'secret' },
    { fetch },
  )(request());
  const url = new URL(seenUrl);
  expect(url.origin + url.pathname).toBe(BRAVE_SEARCH_URL);
  expect(url.searchParams.get('q')).toBe('site:example.test "quoted"');
  expect(url.searchParams.get('count')).toBe('7');
  expect(url.searchParams.get('freshness')).toBe('pw');
  expect(seenInit?.method).toBe('GET');
  expect(new Headers(seenInit?.headers).get('Accept')).toBe('application/json');
  expect(new Headers(seenInit?.headers).get('X-Subscription-Token')).toBe(
    'secret',
  );
  expect(new Headers(seenInit?.headers).get('User-Agent')).toBe('llame/test');
  expect(result).toEqual({
    kind: 'results',
    results: [
      {
        title: 'A result',
        url: 'https://example.test/a',
        snippet: 'A & useful result',
        published: '2026-01-01T00:00:00Z',
      },
    ],
  });
});

it.each([
  ['day', 'pd'],
  ['week', 'pw'],
  ['month', 'pm'],
  ['year', 'py'],
] as const)('maps %s recency to %s freshness', async (recency, freshness) => {
  let seenUrl = '';
  const fetch: VendorFetch = (input) => {
    seenUrl = requestUrl(input);
    return Promise.resolve(emptyResponse());
  };
  await createBraveEngine({ key: 'secret' }, { fetch })(request({ recency }));
  expect(new URL(seenUrl).searchParams.get('freshness')).toBe(freshness);
});

it('returns empty when Brave has no results', async () => {
  const engine = createBraveEngine(
    { key: 'secret' },
    { fetch: () => Promise.resolve(emptyResponse()) },
  );
  await expect(engine(request())).resolves.toEqual({ kind: 'empty' });
});

it('classifies auth without exposing an echoed key', async () => {
  const key = 'secret-key';
  const engine = createBraveEngine(
    { key },
    {
      fetch: () =>
        Promise.resolve(new Response(`failure body ${key}`, { status: 401 })),
    },
  );
  let failure: unknown;
  try {
    await engine(request());
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(EngineFailure);
  if (!(failure instanceof EngineFailure))
    throw new Error('expected EngineFailure');
  expect(failure.failureClass).toBe('auth');
  expect(failure.message).not.toContain(key);
});

it('classifies rate limits and refuses redirects', async () => {
  const rateLimited = createBraveEngine(
    { key: 'secret' },
    { fetch: () => Promise.resolve(new Response('', { status: 429 })) },
  );
  await expect(rateLimited(request())).rejects.toMatchObject({
    failureClass: 'rate_limited',
  });
  let requests = 0;
  const redirected = createBraveEngine(
    { key: 'secret' },
    {
      fetch: () => {
        requests += 1;
        return Promise.resolve(
          new Response('', {
            status: 302,
            headers: { location: 'https://other.example.test/' },
          }),
        );
      },
    },
  );
  await expect(redirected(request())).rejects.toMatchObject({
    failureClass: 'upstream_error',
  });
  expect(requests).toBe(1);
});
