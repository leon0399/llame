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
const WEEK_NOTE = 'SearXNG mapped week recency to month.';

function mapSearxngResult(value: unknown): Array<RawResult> {
  const parsed = SearxngResultSchema.safeParse(value);
  if (!parsed.success) return [];
  const { data } = parsed;
  return [
    {
      title: data.title,
      url: data.url,
      ...(data.content !== undefined && { snippet: data.content }),
      ...(data.publishedDate !== undefined &&
        data.publishedDate !== null && { published: data.publishedDate }),
    },
  ];
}

function searchUrl(baseUrl: string, request: EngineRequest): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL('search', base);
  url.searchParams.set('q', request.query);
  url.searchParams.set('format', 'json');
  if (request.recency !== undefined)
    url.searchParams.set(
      'time_range',
      request.recency === 'week' ? 'month' : request.recency,
    );
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
  deps: { readonly fetch: VendorFetch },
): Engine {
  const fetch = searxngFetch(deps.fetch);
  return async (request: EngineRequest) => {
    const extra = request.recency === 'week' ? { notes: [WEEK_NOTE] } : {};
    const payload = await fetchVendorJson(
      searchUrl(config.baseUrl, request).href,
      { method: 'GET', headers: { Accept: 'application/json' } },
      {
        signal: request.signal,
        fetch,
        userAgent: request.userAgent,
      },
      SearxngPayloadSchema,
    );
    const results = payload.results.flatMap(mapSearxngResult);
    return results.length > 0
      ? { kind: 'results', results, ...extra }
      : { kind: 'empty', ...extra };
  };
}
