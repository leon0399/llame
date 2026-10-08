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
  id: z.string(),
});
type PerplexityPayload = z.infer<typeof PerplexityPayloadSchema>;
type PerplexityRequestBody = {
  readonly query: string;
  readonly max_results: number;
  readonly search_recency_filter?: NonNullable<EngineRequest['recency']>;
  readonly search_domain_filter?: ReadonlyArray<string>;
};
type DomainPlan = {
  readonly query: string;
  readonly domains: ReadonlyArray<string>;
  readonly stayedInQuery: boolean;
};
type RequestPlan = {
  readonly body: PerplexityRequestBody;
  readonly stayedInQuery: boolean;
};

function parsePerplexityPayload(body: string): PerplexityPayload {
  // SAFETY: JSON.parse returns any; Zod validates the complete Perplexity envelope.
  return PerplexityPayloadSchema.parse(JSON.parse(body) as unknown);
}

function mapPerplexityResult(value: unknown): RawResult | undefined {
  const parsed = PerplexityResultSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { data } = parsed;
  return {
    title: data.title,
    url: data.url,
    snippet: data.snippet,
    ...(data.date !== undefined &&
      data.date !== null && { published: data.date }),
  };
}

function readResults(payload: PerplexityPayload): Array<RawResult> {
  return payload.results.flatMap((value) => {
    const result = mapPerplexityResult(value);
    return result === undefined ? [] : [result];
  });
}

function domainPlan(query: string): DomainPlan {
  const filters = splitSiteFilters(query);
  if (filters.include.length > 0) {
    const domains = filters.include.slice(0, DOMAIN_FILTER_LIMIT);
    const stayed = [
      ...filters.include
        .slice(DOMAIN_FILTER_LIMIT)
        .map((host) => `site:${host}`),
      ...filters.exclude.map((host) => `-site:${host}`),
    ];
    return {
      query: [...stayed, filters.query]
        .filter((part) => part.length > 0)
        .join(' '),
      domains,
      stayedInQuery: stayed.length > 0,
    };
  }
  const domains = filters.exclude
    .slice(0, DOMAIN_FILTER_LIMIT)
    .map((host) => `-${host}`);
  const stayed = filters.exclude
    .slice(DOMAIN_FILTER_LIMIT)
    .map((host) => `-site:${host}`);
  return {
    query: [...stayed, filters.query]
      .filter((part) => part.length > 0)
      .join(' '),
    domains,
    stayedInQuery: stayed.length > 0,
  };
}

function requestBody(request: EngineRequest): RequestPlan {
  const plan = domainPlan(request.query);
  return {
    body: {
      query: plan.query,
      max_results: request.limit,
      ...(request.recency !== undefined && {
        search_recency_filter: request.recency,
      }),
      ...(plan.domains.length > 0 && {
        search_domain_filter: plan.domains,
      }),
    },
    stayedInQuery: plan.stayedInQuery,
  };
}

/** Create a Perplexity Search API adapter for one resolved operator engine. */
export function createPerplexityEngine(
  config: { readonly key: string },
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const { body: requestPayload, stayedInQuery } = requestBody(request);
    const payload = await fetchVendorJson(
      PERPLEXITY_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      parsePerplexityPayload,
    );
    const results = readResults(payload);
    if (results.length > 0) {
      return stayedInQuery
        ? { kind: 'results', results, notes: [DOMAIN_FILTER_NOTE] }
        : { kind: 'results', results };
    }
    return stayedInQuery
      ? { kind: 'empty', notes: [DOMAIN_FILTER_NOTE] }
      : { kind: 'empty' };
  };
}
