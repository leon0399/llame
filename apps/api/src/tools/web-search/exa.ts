import { z } from 'zod';
import { type Engine, type EngineRequest, type RawResult } from './chain';
import { fetchVendorJson, type VendorFetch } from './http';
import { splitSiteFilters } from './query';

export const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_MS: Readonly<
  Record<NonNullable<EngineRequest['recency']>, number>
> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};
const ExaResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  publishedDate: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});
const ExaPayloadSchema = z.object({ results: z.array(z.unknown()) });

function mapExaResult(value: unknown): Array<RawResult> {
  const parsed = ExaResultSchema.safeParse(value);
  if (!parsed.success) return [];
  const { data } = parsed;
  return [
    {
      title: data.title,
      url: data.url,
      ...(data.highlights?.[0] !== undefined && {
        snippet: data.highlights[0],
      }),
      ...(data.publishedDate !== undefined && {
        published: data.publishedDate,
      }),
    },
  ];
}

function requestBody(request: EngineRequest) {
  const filters = splitSiteFilters(request.query);
  return {
    query: filters.query || request.query,
    numResults: request.limit,
    ...(filters.include.length > 0 && { includeDomains: filters.include }),
    ...(filters.exclude.length > 0 && { excludeDomains: filters.exclude }),
    ...(request.recency !== undefined && {
      startPublishedDate: new Date(
        Date.now() - RECENCY_MS[request.recency],
      ).toISOString(),
    }),
    contents: { highlights: true },
  };
}

/** Create an Exa Search API adapter for one resolved operator engine. */
export function createExaEngine(
  config: { readonly key: string },
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const payload = await fetchVendorJson(
      EXA_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': config.key,
        },
        body: JSON.stringify(requestBody(request)),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      ExaPayloadSchema,
    );
    const results = payload.results.flatMap(mapExaResult);
    return results.length === 0
      ? { kind: 'empty' }
      : { kind: 'results', results };
  };
}
