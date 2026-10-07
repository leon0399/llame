import { z } from 'zod';
import { type WebSearchEngineConfig } from '../../instance-config/llame-config';
import { type Engine, type EngineRequest, type RawResult } from './chain';
import { fetchVendorJson, type VendorFetch } from './http';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const FRESHNESS_BY_RECENCY: Readonly<
  Record<NonNullable<EngineRequest['recency']>, string>
> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};
const BraveResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  page_age: z.string().optional(),
});
const BravePayloadSchema = z.object({
  web: z.object({ results: z.array(BraveResultSchema) }).optional(),
});

function decodeBasicEntities(value: string): string {
  return value.replaceAll(
    /&(#(?:x[\da-f]{1,6}|\d{1,7})|amp|lt|gt|quot|apos|#39);/giu,
    (entity, name: string) => {
      const key = name.toLowerCase();
      if (key === 'amp') return '&';
      if (key === 'lt') return '<';
      if (key === 'gt') return '>';
      if (key === 'quot') return '"';
      if (key === 'apos' || key === '#39') return "'";
      const code = key.startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 1_114_111
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}

export function stripHtmlTags(value: string): string {
  return decodeBasicEntities(value.replaceAll(/<[^>]*>/gu, ''));
}

function readResults(payload: unknown): ReadonlyArray<RawResult> {
  const parsed = BravePayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.web === undefined) return [];
  return parsed.data.web.results.map((value) => ({
    title: stripHtmlTags(value.title),
    url: value.url,
    ...(value.description !== undefined && {
      snippet: stripHtmlTags(value.description),
    }),
    ...(value.page_age !== undefined && { published: value.page_age }),
  }));
}

/** Create a Brave Search API adapter for one resolved operator engine. */
export function createBraveEngine(
  config: Pick<WebSearchEngineConfig, 'key'>,
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set('q', request.query);
    url.searchParams.set('count', String(request.limit));
    if (request.recency !== undefined)
      url.searchParams.set('freshness', FRESHNESS_BY_RECENCY[request.recency]);
    const payload = await fetchVendorJson(
      url.href,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': config.key,
        },
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
    );
    const results = readResults(payload);
    return results.length === 0
      ? { kind: 'empty' }
      : { kind: 'results', results };
  };
}

export { BRAVE_SEARCH_URL, FRESHNESS_BY_RECENCY };
