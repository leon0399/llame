import { z } from 'zod';
import { EXA_SEARCH_URL, createExaEngine } from './exa';
import { type EngineRequest } from './chain';
import { type VendorFetch } from './http';

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
  readonly publishedDate?: string;
  readonly highlights?: Array<string>;
  readonly text?: string;
};
type FixtureBody =
  | string
  | { readonly results: Array<FixtureResult> }
  | { readonly results: string };
const ExaRequestBodySchema = z.object({
  query: z.string(),
  numResults: z.number(),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
  startPublishedDate: z.string().optional(),
  contents: z.object({ highlights: z.literal(true) }),
});
type ExaRequestBody = z.infer<typeof ExaRequestBodySchema>;
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
async function parseBody(
  init: RequestInit | undefined,
): Promise<ExaRequestBody> {
  const text = await new Response(init?.body ?? null).text();
  // SAFETY: The schema validates JSON parsed from the captured vendor request.
  return ExaRequestBodySchema.parse(JSON.parse(text) as unknown);
}
const now = (): Date => new Date('2026-10-08T12:00:00.000Z');

it('sends the Exa request and maps filters, cutoff, and snippets', async () => {
  const fixture = {
    results: [
      {
        title: 'A result',
        url: 'https://example.test/a',
        publishedDate: '2026-10-07',
        highlights: ['highlight'],
      },
      { title: 'Text result', url: 'https://example.test/b', text: 'text' },
      { title: 'Malformed', url: 3 },
    ],
  };
  const recorded = capture(fixture);
  const result = await createExaEngine(
    { key: 'secret' },
    { fetch: recorded.fetch, now },
  )(request());
  expect(recorded.seen().url).toBe(EXA_SEARCH_URL);
  expect(recorded.seen().init?.method).toBe('POST');
  const headers = new Headers(recorded.seen().init?.headers);
  expect(headers.get('accept')).toBe('application/json');
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('user-agent')).toBe('llame/test');
  expect(headers.get('x-api-key')).toBe('secret');
  expect(await parseBody(recorded.seen().init)).toEqual({
    query: 'latest',
    numResults: 7,
    includeDomains: ['example.test'],
    excludeDomains: ['spam.test'],
    startPublishedDate: '2026-10-01T12:00:00.000Z',
    contents: { highlights: true },
  });
  expect(result).toEqual({
    kind: 'results',
    results: [
      {
        title: 'A result',
        url: 'https://example.test/a',
        snippet: 'highlight',
        published: '2026-10-07',
      },
      { title: 'Text result', url: 'https://example.test/b', snippet: 'text' },
    ],
  });
});

it.each([
  ['day', '2026-10-07T12:00:00.000Z'],
  ['week', '2026-10-01T12:00:00.000Z'],
  ['month', '2026-09-08T12:00:00.000Z'],
  ['year', '2025-10-08T12:00:00.000Z'],
] as const)('maps %s recency to %s', async (recency, expected) => {
  const recorded = capture({ results: [] });
  await createExaEngine(
    { key: 'secret' },
    { fetch: recorded.fetch, now },
  )(request({ query: 'plain', recency }));
  expect(await parseBody(recorded.seen().init)).toMatchObject({
    startPublishedDate: expected,
  });
});

it('omits optional request fields when unset', async () => {
  const recorded = capture({ results: [] });
  await createExaEngine(
    { key: 'secret' },
    { fetch: recorded.fetch, now },
  )(request({ query: 'plain', recency: undefined }));
  expect(await parseBody(recorded.seen().init)).toEqual({
    query: 'plain',
    numResults: 7,
    contents: { highlights: true },
  });
});

it('returns empty for no valid Exa results', async () => {
  const engine = createExaEngine(
    { key: 'secret' },
    { fetch: capture({ results: [{ title: 'bad' }] }).fetch, now },
  );
  await expect(engine(request())).resolves.toEqual({ kind: 'empty' });
});

it('rejects a malformed Exa envelope', async () => {
  const engine = createExaEngine(
    { key: 'secret' },
    { fetch: capture({ results: 'bad' }).fetch, now },
  );
  await expect(engine(request())).rejects.toMatchObject({
    failureClass: 'upstream_error',
  });
});

it.each([
  [401, 'auth'],
  [429, 'rate_limited'],
  [503, 'upstream_error'],
] as const)('classifies HTTP %s as %s', async (status, failureClass) => {
  const key = 'secret-key';
  const engine = createExaEngine(
    { key },
    { fetch: capture(`body ${key}`, status).fetch, now },
  );
  await expect(engine(request())).rejects.toMatchObject({ failureClass });
  await expect(engine(request())).rejects.not.toThrow(key);
});

it('refuses redirects without following them', async () => {
  let requests = 0;
  const engine = createExaEngine(
    { key: 'secret' },
    {
      now,
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
