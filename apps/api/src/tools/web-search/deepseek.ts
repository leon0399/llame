import { z } from 'zod';
import { type Engine, type EngineRequest, type RawResult } from './chain';
import { fetchVendorJson, type VendorFetch } from './http';
import { ENGINE_LIMITS, acceptsQuery, vendorCount } from './limits';
import { recencyDate } from './query';

export const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';
/** The vendor's bound on `ori_question`, in code points. */
const ORI_QUESTION_MAX_CODE_POINTS = 128;
const RECENCY_NOTE = 'recency not applied by deepseek';
const DeepseekResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  summary: z.string().optional(),
  date: z.string().nullable().optional(),
});
const DeepseekPayloadSchema = z.object({ results: z.array(z.unknown()) });

function mapDeepseekResult(value: unknown): Array<RawResult> {
  const parsed = DeepseekResultSchema.safeParse(value);
  if (!parsed.success) return [];
  const { data } = parsed;
  // `summary` is the longer, model-oriented field; a blank one falls back.
  const snippet = data.summary || data.snippet;
  return [
    {
      title: data.title,
      url: data.url,
      ...(snippet !== undefined && { snippet }),
      ...(data.date !== undefined &&
        data.date !== null && { published: data.date }),
    },
  ];
}

/**
 * The query with `recency` as an `after:` date, which is the only date filter
 * DeepSeek has. The vendor also caps the query at 128 code points, so a date
 * that would put it over is dropped instead of the query.
 */
function datedQuery(query: string, recency: EngineRequest['recency']) {
  if (recency === undefined) return { query, applied: true };
  const dated = `${query} after:${recencyDate(recency)}`;
  return acceptsQuery(ENGINE_LIMITS.deepseek, dated)
    ? { query: dated, applied: true }
    : { query, applied: false };
}

function requestBody(request: EngineRequest, query: string) {
  return {
    query,
    count: vendorCount('deepseek', request.limit),
    ...(request.objective !== undefined && {
      ori_question: Array.from(request.objective)
        .slice(0, ORI_QUESTION_MAX_CODE_POINTS)
        .join(''),
    }),
  };
}

/** Create a DeepSeek Search API adapter for one resolved operator engine. */
export function createDeepseekEngine(
  config: { readonly key: string },
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const dated = datedQuery(request.query, request.recency);
    const extra = dated.applied ? {} : { notes: [RECENCY_NOTE] };
    const payload = await fetchVendorJson(
      DEEPSEEK_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify(requestBody(request, dated.query)),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      DeepseekPayloadSchema,
    );
    const results = payload.results.flatMap(mapDeepseekResult);
    return results.length > 0
      ? { kind: 'results', results, ...extra }
      : { kind: 'empty', ...extra };
  };
}
