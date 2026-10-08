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
  text: z.string().optional(),
});
const ExaPayloadSchema = z.object({ results: z.array(z.unknown()) });
type ExaPayload = z.infer<typeof ExaPayloadSchema>;
export type ExaDependencies = {
  readonly fetch: VendorFetch;
  readonly now?: () => Date;
};

type ExaRequestBody = {
  readonly query: string;
  readonly numResults: number;
  readonly includeDomains?: ReadonlyArray<string>;
  readonly excludeDomains?: ReadonlyArray<string>;
  readonly startPublishedDate?: string;
  readonly contents: { readonly highlights: true };
};

function parseExaPayload(body: string): ExaPayload {
  // SAFETY: JSON.parse returns any; Zod validates the complete Exa envelope.
  return ExaPayloadSchema.parse(JSON.parse(body) as unknown);
}

function mapExaResult(value: unknown): RawResult | undefined {
  const parsed = ExaResultSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { data } = parsed;
  const snippet = data.highlights?.[0] ?? data.text;
  return {
    title: data.title,
    url: data.url,
    ...(snippet !== undefined && { snippet }),
    ...(data.publishedDate !== undefined && { published: data.publishedDate }),
  };
}

function readResults(payload: ExaPayload): Array<RawResult> {
  return payload.results.flatMap((value) => {
    const result = mapExaResult(value);
    return result === undefined ? [] : [result];
  });
}

function cutoffDate(
  recency: EngineRequest['recency'],
  now: () => Date,
): string | undefined {
  if (recency === undefined) return undefined;
  return new Date(now().getTime() - RECENCY_MS[recency]).toISOString();
}

function requestBody(request: EngineRequest, now: () => Date): ExaRequestBody {
  const filters = splitSiteFilters(request.query);
  const startPublishedDate = cutoffDate(request.recency, now);
  return {
    query: filters.query,
    numResults: request.limit,
    ...(filters.include.length > 0 && { includeDomains: filters.include }),
    ...(filters.exclude.length > 0 && { excludeDomains: filters.exclude }),
    ...(startPublishedDate !== undefined && { startPublishedDate }),
    contents: { highlights: true },
  };
}

/** Create an Exa Search API adapter for one resolved operator engine. */
export function createExaEngine(
  config: { readonly key: string },
  deps: ExaDependencies,
): Engine {
  const now = deps.now ?? (() => new Date());
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
        body: JSON.stringify(requestBody(request, now)),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      parseExaPayload,
    );
    const results = readResults(payload);
    return results.length === 0
      ? { kind: 'empty' }
      : { kind: 'results', results };
  };
}
