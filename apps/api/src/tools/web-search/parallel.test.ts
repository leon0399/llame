import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PARALLEL_SEARCH_URL, createParallelEngine } from './parallel';

import { type EngineRequest } from './chain';
import { removalFor } from '../../testing/web-search-removal';
import { captureFetch } from '../../testing/web-search-fetch';

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'rerank',
  objective: undefined,
  recency: undefined,
  limit: 4,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  chatId: 'chat-1',
  removal: removalFor(undefined),
  ...overrides,
});
const ParallelRequestSchema = z.object({
  search_queries: z.array(z.string()),
  objective: z.string().optional(),
  mode: z.string(),
  session_id: z.string(),
  advanced_settings: z.object({
    max_results: z.number(),
    excerpt_settings: z.object({ max_chars_per_result: z.number() }),
    source_policy: z
      .object({
        include_domains: z.array(z.string()).optional(),
        exclude_domains: z.array(z.string()).optional(),
        after_date: z.string().optional(),
      })
      .optional(),
  }),
});
type ParallelRequest = z.infer<typeof ParallelRequestSchema>;
async function parseBody(
  init: RequestInit | undefined,
): Promise<ParallelRequest> {
  const text = await new Response(init?.body ?? null).text();
  // SAFETY: The schema validates JSON parsed from the captured vendor request.
  return ParallelRequestSchema.parse(JSON.parse(text) as unknown);
}

/** One result of the shape a live probe returned, with vendor text scrubbed. */
const recordedResult = {
  url: 'https://example.test/pgvector',
  title: 'pgvector 0.8.7 Released',
  publish_date: '2026-10-05',
  excerpts: ['pgvector 0.8.7 adds HNSW index build parallelism.'],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('Parallel adapter', () => {
  it('sends the request and maps an excerpt and publish date', async () => {
    const recorded = captureFetch(
      JSON.stringify({ search_id: 'search_1', results: [recordedResult] }),
    );
    const result = await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: recorded.fetch },
    )(request({ recency: 'week' }));
    expect(recorded.seen().url).toBe(PARALLEL_SEARCH_URL);
    expect(recorded.seen().init?.method).toBe('POST');
    const headers = new Headers(recorded.seen().init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe('llame/test');
    expect(headers.get('x-api-key')).toBe('secret');
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      search_queries: ['rerank'],
      mode: 'fast',
      session_id: 'chat-1',
      advanced_settings: {
        max_results: 4,
        excerpt_settings: { max_chars_per_result: 1000 },
        source_policy: { after_date: '2026-10-20' },
      },
    });
    expect(result).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'pgvector 0.8.7 Released',
          url: 'https://example.test/pgvector',
          snippet: 'pgvector 0.8.7 adds HNSW index build parallelism.',
          published: '2026-10-05',
        },
      ],
    });
  });

  it('moves site operators into the source policy', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    const result = await createParallelEngine(
      { key: 'secret', mode: 'advanced' },
      { fetch: recorded.fetch },
    )(request({ query: 'rerank site:arxiv.org' }));
    expect(result).not.toHaveProperty('notes');
    const body = await parseBody(recorded.seen().init);
    expect(body.search_queries).toStrictEqual(['rerank']);
    expect(body.mode).toBe('advanced');
    expect(body.advanced_settings.source_policy).toStrictEqual({
      include_domains: ['arxiv.org'],
    });
    expect(body.advanced_settings).not.toHaveProperty(
      'source_policy.after_date',
    );
  });

  it('falls back to the query when only site operators were removed', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: recorded.fetch },
    )(request({ query: 'site:arxiv.org' }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      search_queries: ['site:arxiv.org'],
      mode: 'fast',
      session_id: 'chat-1',
      advanced_settings: {
        max_results: 4,
        excerpt_settings: { max_chars_per_result: 1000 },
        source_policy: { include_domains: ['arxiv.org'] },
      },
    });
  });

  it('sends exclusions only when there are no inclusions', async () => {
    const excluded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: excluded.fetch },
    )(request({ query: 'rerank -site:spam.test' }));
    expect(
      (await parseBody(excluded.seen().init)).advanced_settings.source_policy,
    ).toStrictEqual({ exclude_domains: ['spam.test'] });

    const mixed = captureFetch(JSON.stringify({ results: [recordedResult] }));
    const result = await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: mixed.fetch },
    )(request({ query: 'rerank site:arxiv.org -site:spam.test' }));
    expect(
      (await parseBody(mixed.seen().init)).advanced_settings.source_policy,
    ).toStrictEqual({ include_domains: ['arxiv.org'] });
    expect(result).toMatchObject({
      notes: ['parallel ignored the excluded domains'],
    });
  });

  it('omits the source policy when the query has no filters', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: recorded.fetch },
    )(request());
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      search_queries: ['rerank'],
      mode: 'fast',
      session_id: 'chat-1',
      advanced_settings: {
        max_results: 4,
        excerpt_settings: { max_chars_per_result: 1000 },
      },
    });
  });

  it('sends the objective as its own field', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: recorded.fetch },
    )(request({ objective: 'rank primary sources first' }));
    expect(await parseBody(recorded.seen().init)).toStrictEqual({
      search_queries: ['rerank'],
      objective: 'rank primary sources first',
      mode: 'fast',
      session_id: 'chat-1',
      advanced_settings: {
        max_results: 4,
        excerpt_settings: { max_chars_per_result: 1000 },
      },
    });
  });

  it('strips a leading copy of the title from an excerpt', async () => {
    const recorded = captureFetch(
      JSON.stringify({
        results: [
          {
            url: 'https://example.test/heading',
            title: 'pgvector 0.8.7 Released',
            publish_date: null,
            excerpts: ['# pgvector 0.8.7 Released\n\nIt adds iterators.'],
          },
          {
            url: 'https://example.test/plain',
            title: 'PostgreSQL: pgvector 0.8.7 Released',
            excerpts: ['PostgreSQL: pgvector 0.8.7 Released\nMore text.'],
          },
          {
            url: 'https://example.test/different',
            title: 'Other title',
            excerpts: ['A first line that differs.\nMore text.'],
          },
          {
            url: 'https://example.test/single',
            title: 'Only a title',
            excerpts: ['Only a title'],
          },
          { url: 'https://example.test/untitled', title: null, excerpts: [] },
          { title: 'Missing URL' },
        ],
      }),
    );
    const result = await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: recorded.fetch },
    )(request());
    expect(result).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'pgvector 0.8.7 Released',
          url: 'https://example.test/heading',
          snippet: 'It adds iterators.',
        },
        {
          title: 'PostgreSQL: pgvector 0.8.7 Released',
          url: 'https://example.test/plain',
          snippet: 'More text.',
        },
        {
          title: 'Other title',
          url: 'https://example.test/different',
          snippet: 'A first line that differs.\nMore text.',
        },
        {
          title: 'Only a title',
          url: 'https://example.test/single',
          snippet: 'Only a title',
        },
        { title: '', url: 'https://example.test/untitled' },
      ],
    });
  });

  it('clamps the count to the vendor maximum', async () => {
    const recorded = captureFetch(
      JSON.stringify({ results: [recordedResult] }),
    );
    await createParallelEngine(
      { key: 'secret', mode: 'fast' },
      { fetch: recorded.fetch },
    )(request({ limit: 40 }));
    expect(
      (await parseBody(recorded.seen().init)).advanced_settings.max_results,
    ).toBe(20);
  });

  it('is empty when the vendor has no match', async () => {
    const recorded = captureFetch(JSON.stringify({ results: [] }));
    await expect(
      createParallelEngine(
        { key: 'secret', mode: 'fast' },
        {
          fetch: recorded.fetch,
        },
      )(request()),
    ).resolves.toStrictEqual({ kind: 'empty' });
  });

  it('classifies statuses without exposing the vendor body', async () => {
    const cases = [
      [401, 'auth', 'The web search engine rejected authentication.'],
      [403, 'auth', 'The web search engine rejected authentication.'],
      [429, 'rate_limited', 'The web search engine rate limited the request.'],
      [408, 'timeout', 'The web search engine timed out.'],
      [504, 'timeout', 'The web search engine timed out.'],
      [402, 'upstream_error', 'The web search engine failed upstream.'],
      [422, 'upstream_error', 'The web search engine failed upstream.'],
    ] as const;

    for (const [status, failureClass, message] of cases) {
      const engine = createParallelEngine(
        { key: 'secret', mode: 'fast' },
        {
          fetch: () =>
            Promise.resolve(
              new Response(`{"error":{"message":"ref_id search_1"}}`, {
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
