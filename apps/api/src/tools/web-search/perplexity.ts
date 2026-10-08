import { z } from 'zod';
import { type Engine, type EngineRequest, type RawResult } from './chain';
import { fetchVendorJson, type VendorFetch } from './http';
import { splitSiteFilters } from './query';

export const PERPLEXITY_SEARCH_URL = 'https://api.perplexity.ai/search';
const DOMAIN_FILTER_LIMIT = 20;
const DOMAIN_FILTER_NOTE = 'Some site filters remained in the query.';
const PerplexityResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  date: z.string().nullable().optional(),
});
const PerplexityPayloadSchema = z.object({
  results: z.array(z.unknown()),
});

function mapPerplexityResult(value: unknown): Array<RawResult> {
  const parsed = PerplexityResultSchema.safeParse(value);
  if (!parsed.success) return [];
  const { data } = parsed;
  return [
    {
      title: data.title,
      url: data.url,
      snippet: data.snippet,
      ...(data.date !== undefined &&
        data.date !== null && { published: data.date }),
    },
  ];
}

function domainPlan(query: string) {
  const filters = splitSiteFilters(query);
  const allow = filters.include.length > 0;
  const hosts = allow ? filters.include : filters.exclude;
  const stayed = [
    ...hosts
      .slice(DOMAIN_FILTER_LIMIT)
      .map((host) => `${allow ? '' : '-'}site:${host}`),
    ...(allow ? filters.exclude.map((host) => `-site:${host}`) : []),
  ];
  return {
    query:
      [...stayed, filters.query].filter((part) => part.length > 0).join(' ') ||
      query,
    domains: hosts
      .slice(0, DOMAIN_FILTER_LIMIT)
      .map((host) => (allow ? host : `-${host}`)),
    stayedInQuery: stayed.length > 0,
  };
}

/** Create a Perplexity Search API adapter for one resolved operator engine. */
export function createPerplexityEngine(
  config: { readonly key: string },
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const plan = domainPlan(request.query);
    const extra = plan.stayedInQuery ? { notes: [DOMAIN_FILTER_NOTE] } : {};
    const payload = await fetchVendorJson(
      PERPLEXITY_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: plan.query,
          max_results: request.limit,
          ...(request.recency !== undefined && {
            search_recency_filter: request.recency,
          }),
          ...(plan.domains.length > 0 && {
            search_domain_filter: plan.domains,
          }),
        }),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      PerplexityPayloadSchema,
    );
    const results = payload.results.flatMap(mapPerplexityResult);
    return results.length > 0
      ? { kind: 'results', results, ...extra }
      : { kind: 'empty', ...extra };
  };
}
