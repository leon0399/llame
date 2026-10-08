import { z } from 'zod';
import {
  EngineFailure,
  type Engine,
  type EngineRequest,
  type RawResult,
} from './chain';
import { fetchVendorJson, type VendorFetch } from './http';

const SearxngPayloadSchema = z.object({ results: z.array(z.unknown()) });
const SearxngResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().optional(),
  publishedDate: z.string().nullable().optional(),
});
type SearxngPayload = z.infer<typeof SearxngPayloadSchema>;
const TIME_RANGE_BY_RECENCY: Readonly<
  Record<NonNullable<EngineRequest['recency']>, string>
> = {
  day: 'day',
  week: 'month',
  month: 'month',
  year: 'year',
};
const WEEK_NOTE = 'SearXNG mapped week recency to month.';

type SearxngDependencies = { readonly fetch: VendorFetch };

function parseSearxngPayload(body: string): SearxngPayload {
  // SAFETY: JSON.parse returns any; Zod validates the complete SearXNG envelope.
  return SearxngPayloadSchema.parse(JSON.parse(body) as unknown);
}

function mapSearxngResult(value: unknown): RawResult | undefined {
  const parsed = SearxngResultSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { data } = parsed;
  return {
    title: data.title,
    url: data.url,
    ...(data.content !== undefined && { snippet: data.content }),
    ...(data.publishedDate !== undefined &&
      data.publishedDate !== null && { published: data.publishedDate }),
  };
}

function readResults(payload: SearxngPayload, limit: number): Array<RawResult> {
  return payload.results
    .flatMap((value) => {
      const result = mapSearxngResult(value);
      return result === undefined ? [] : [result];
    })
    .slice(0, limit);
}

function searchUrl(baseUrl: string, request: EngineRequest): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL('search', base);
  url.searchParams.set('q', request.query);
  url.searchParams.set('format', 'json');
  if (request.recency !== undefined)
    url.searchParams.set('time_range', TIME_RANGE_BY_RECENCY[request.recency]);
  return url;
}

function searxngFetch(fetch: VendorFetch): VendorFetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new EngineFailure('upstream_error');
    }
    return response;
  };
}

/** Create a SearXNG JSON API adapter for one operator instance. */
export function createSearxngEngine(
  config: { readonly baseUrl: string },
  deps: SearxngDependencies,
): Engine {
  const fetch = searxngFetch(deps.fetch);
  return async (request: EngineRequest) => {
    const payload = await fetchVendorJson(
      searchUrl(config.baseUrl, request).href,
      { method: 'GET', headers: { Accept: 'application/json' } },
      {
        signal: request.signal,
        fetch,
        userAgent: request.userAgent,
      },
      parseSearxngPayload,
    );
    const results = readResults(payload, request.limit);
    if (results.length > 0) {
      return request.recency === 'week'
        ? { kind: 'results', results, notes: [WEEK_NOTE] }
        : { kind: 'results', results };
    }
    return request.recency === 'week'
      ? { kind: 'empty', notes: [WEEK_NOTE] }
      : { kind: 'empty' };
  };
}
