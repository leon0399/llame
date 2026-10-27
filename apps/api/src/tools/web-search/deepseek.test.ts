import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DEEPSEEK_SEARCH_URL, createDeepseekEngine } from './deepseek';

import { type EngineRequest } from './chain';
import { removalFor } from '../../testing/web-search-removal';
import { captureFetch } from '../../testing/web-search-fetch';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'pgvector release',
  objective: undefined,
  recency: 'week',
  limit: 7,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  chatId: 'chat',
  removal: removalFor(undefined),
  ...overrides,
});
const DeepseekRequestSchema = z.object({
  query: z.string(),
  count: z.number(),
  ori_question: z.string().optional(),
});
type DeepseekRequest = z.infer<typeof DeepseekRequestSchema>;
async function parseBody(
  init: RequestInit | undefined,
): Promise<DeepseekRequest> {
  const text = await new Response(init?.body ?? null).text();
  // SAFETY: The schema validates JSON parsed from the captured vendor request.
  return DeepseekRequestSchema.parse(JSON.parse(text) as unknown);
}

/** One result of the shape a live probe returned, key and content scrubbed. */
const recordedResult = {
  title: 'pgvector 0.8.7 Released',
  site_name: 'postgresql.org',
  site_icon: 'https://example.test/icon.png',
  authority: 3,
  rerank_score: 1.8729981184005735,
  date: '2026-10-05T00:00:00+00:00',
  url: 'https://www.postgresql.org/about/news/pgvector-087-released-3392/',
  summary: 'pgvector 0.8.7 adds HNSW index build parallelism and iterators.',
  snippet: 'pgvector 0.8.7 Released. Posted on 2026-10-05 by pgvector.',
  content: '',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('DeepSeek adapter', () => {
  it('sends the request and maps the summary, date, and count', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    const result = await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request());
    expect(recorded.seen().url).toBe(DEEPSEEK_SEARCH_URL);
    expect(recorded.seen().init?.method).toBe('POST');
    const headers = new Headers(recorded.seen().init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('llame/test');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'pgvector release after:2026-10-20',
      count: 7,
    });
    expect(result).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'pgvector 0.8.7 Released',
          url: 'https://www.postgresql.org/about/news/pgvector-087-released-3392/',
          snippet:
            'pgvector 0.8.7 adds HNSW index build parallelism and iterators.',
          published: '2026-10-05T00:00:00+00:00',
        },
      ],
    });
  });

  it('falls back to the snippet when the summary is blank', async () => {
    const recorded = captureFetch(
      JSON.stringify({
        results: [
          { ...recordedResult, summary: '', url: 'https://example.test/a' },
          {
            title: 'No summary',
            url: 'https://example.test/b',
            snippet: 'short snippet',
            date: null,
          },
          { title: 'Malformed', url: 3 },
        ],
      }),
    );
    const result = await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ recency: undefined }));
    expect(result).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'pgvector 0.8.7 Released',
          url: 'https://example.test/a',
          snippet: 'pgvector 0.8.7 Released. Posted on 2026-10-05 by pgvector.',
          published: '2026-10-05T00:00:00+00:00',
        },
        {
          title: 'No summary',
          url: 'https://example.test/b',
          snippet: 'short snippet',
        },
      ],
    });
  });

  it('cuts the objective to the vendor field limit without a note', async () => {
    const objective = `z${'o'.repeat(299)}`;
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    const result = await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ objective }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'pgvector release after:2026-10-20',
      count: 7,
      ori_question: `z${'o'.repeat(127)}`,
    });
    expect(result).not.toHaveProperty('notes');
  });

  it('omits the date when the query would exceed the vendor limit', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    const result = await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'x'.repeat(125) }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: 'x'.repeat(125),
      count: 7,
    });
    expect(result).toMatchObject({
      notes: ['recency not applied by deepseek'],
    });
  });

  it('keeps a dated query that fits the vendor limit exactly', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    const result = await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ query: 'x'.repeat(111) }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      query: `${'x'.repeat(111)} after:2026-10-20`,
      count: 7,
    });
    expect(result).not.toHaveProperty('notes');
  });

  it('clamps the count to the vendor maximum', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ limit: 60 }));
    expect((await parseBody(recorded.seen().init)).count).toBe(50);
  });

  it('passes a small limit unchanged', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createDeepseekEngine(
      { key: 'secret' },
      { fetch: recorded.fetch },
    )(request({ limit: 5 }));
    expect((await parseBody(recorded.seen().init)).count).toBe(5);
  });

  it('is empty when the vendor has no match', async () => {
    const recorded = captureFetch(JSON.stringify({ results: [] }));
    await expect(
      createDeepseekEngine(
        { key: 'secret' },
        { fetch: recorded.fetch },
      )(request()),
    ).resolves.toStrictEqual({ kind: 'empty' });
  });

  it('classifies statuses without exposing an echoed key', async () => {
    const cases = [
      [401, 'auth', 'The web search engine rejected authentication.'],
      [403, 'auth', 'The web search engine rejected authentication.'],
      [429, 'rate_limited', 'The web search engine rate limited the request.'],
      [408, 'timeout', 'The web search engine timed out.'],
      [504, 'timeout', 'The web search engine timed out.'],
      [402, 'upstream_error', 'The web search engine failed upstream.'],
      [500, 'upstream_error', 'The web search engine failed upstream.'],
    ] as const;

    for (const [status, failureClass, message] of cases) {
      const engine = createDeepseekEngine(
        { key: 'secret-key' },
        {
          fetch: () =>
            Promise.resolve(
              // The live endpoint echoes the key's last four characters.
              new Response(`api key: ****-key is invalid (${status})`, {
                status,
              }),
            ),
        },
      );
      // The fixed message is the whole text: the body never reaches it.
      await expect(engine(request())).rejects.toMatchObject({
        failureClass,
        message,
      });
    }
  });
});
