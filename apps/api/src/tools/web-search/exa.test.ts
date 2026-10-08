import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EXA_SEARCH_URL, createExaEngine } from './exa';
import { type EngineRequest } from './chain';
import { captureFetch } from '../../testing/web-search-fetch';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'site:example.test -site:spam.test latest',
  recency: 'week',
  limit: 7,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  chatId: undefined,
  ...overrides,
});
type FixtureResult = {
  readonly title?: string | number;
  readonly url?: string | number;
  readonly publishedDate?: string;
  readonly highlights?: Array<string>;
};
type FixtureBody =
  | string
  | { readonly results: Array<FixtureResult> }
  | { readonly results: string };
const ExaRequestSchema = z.object({
  query: z.string(),
  numResults: z.number(),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
  startPublishedDate: z.string().optional(),
  contents: z.object({ highlights: z.literal(true) }),
});
type ExaRequest = z.infer<typeof ExaRequestSchema>;
async function parseBody(init: RequestInit | undefined): Promise<ExaRequest> {
  const text = await new Response(init?.body ?? null).text();
  // SAFETY: The schema validates JSON parsed from the captured vendor request.
  return ExaRequestSchema.parse(JSON.parse(text) as unknown);
}
function captureFixture(body: FixtureBody, status = 200) {
  return captureFetch(JSON.stringify(body), status);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('Exa adapter', () => {
  it('sends the request and maps filters, cutoff, and snippets', async () => {
    const recorded = captureFixture({
      results: [
        {
          title: 'A result',
          url: 'https://example.test/a',
          publishedDate: '2026-10-07',
          highlights: ['highlight'],
        },
        { title: 'No snippet', url: 'https://example.test/b' },
        { title: 'Malformed', url: 3 },
      ],
    });
    const result = await createExaEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request());
    expect(recorded.seen().url).toBe(EXA_SEARCH_URL);
    expect(recorded.seen().init?.method).toBe('POST');
    const headers = new Headers(recorded.seen().init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('llame/test');
    expect(headers.get('x-api-key')).toBe('secret');
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'latest',
      numResults: 7,
      includeDomains: ['example.test'],
      excludeDomains: ['spam.test'],
      startPublishedDate: '2026-10-01T12:00:00.000Z',
      contents: { highlights: true },
    });
    expect(result).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'A result',
          url: 'https://example.test/a',
          snippet: 'highlight',
          published: '2026-10-07',
        },
        { title: 'No snippet', url: 'https://example.test/b' },
      ],
    });
  });

  it.each([
    ['day', '2026-10-07T12:00:00.000Z'],
    ['week', '2026-10-01T12:00:00.000Z'],
    ['month', '2026-09-08T12:00:00.000Z'],
    ['year', '2025-10-08T12:00:00.000Z'],
  ] as const)('maps %s recency to %s', async (recency, expected) => {
    const recorded = captureFixture({ results: [] });
    await createExaEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'plain', recency }));
    expect(await parseBody(recorded.seen().init)).toMatchObject({
      startPublishedDate: expected,
    });
  });

  it('keeps an operator-only query non-empty', async () => {
    const recorded = captureFixture({ results: [] });
    await createExaEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'site:example.test', recency: undefined }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'site:example.test',
      numResults: 7,
      includeDomains: ['example.test'],
      contents: { highlights: true },
    });
  });
  it('keeps punctuation-wrapped operators in the Exa query', async () => {
    const recorded = captureFixture({ results: [] });
    await createExaEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(
      request({
        query: '"rust site:docs.rs" async',
        recency: undefined,
      }),
    );
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: '"rust site:docs.rs" async',
      numResults: 7,
      contents: { highlights: true },
    });
  });

  it('omits optional request fields when unset', async () => {
    const recorded = captureFixture({ results: [] });
    await createExaEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'plain', recency: undefined }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'plain',
      numResults: 7,
      contents: { highlights: true },
    });
  });

  it('returns empty for no valid Exa results', async () => {
    const engine = createExaEngine(
      { key: 'secret' },
      { fetch: captureFixture({ results: [{ title: 'bad' }] }).fetch },
    );
    await expect(engine(request())).resolves.toStrictEqual({ kind: 'empty' });
  });

  it('rejects a malformed Exa envelope', async () => {
    const engine = createExaEngine(
      { key: 'secret' },
      { fetch: captureFixture({ results: 'bad' }).fetch },
    );
    await expect(engine(request())).rejects.toMatchObject({
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
    const engine = createExaEngine(
      { key },
      { fetch: captureFixture(`body ${key}`, status).fetch },
    );
    await expect(engine(request())).rejects.toMatchObject({ failureClass });
    await expect(engine(request())).rejects.not.toThrow(key);
  });
});
