import { z } from 'zod';
import { type ParallelSearchMode } from '../../instance-config/web-search-config';
import { type Engine, type EngineRequest, type RawResult } from './chain';
import { fetchVendorJson, type VendorFetch } from './http';
import { vendorCount } from './limits';
import { recencyDate, splitSiteFilters, type SiteFilters } from './query';

export const PARALLEL_SEARCH_URL = 'https://api.parallel.ai/v1/search';
/** Above the 300-unit snippet cap, so the output cap cuts and not the vendor. */
const EXCERPT_MAX_CHARS_PER_RESULT = 1000;
const EXCLUSIONS_NOTE = 'parallel ignored the excluded domains';
const ParallelResultSchema = z.object({
  url: z.string(),
  title: z.string().nullable().optional(),
  publish_date: z.string().nullable().optional(),
  excerpts: z.array(z.string()).optional(),
});
export const ParallelPayloadSchema = z.object({
  results: z.array(z.unknown()),
});
export type ParallelPayload = z.infer<typeof ParallelPayloadSchema>;

/**
 * The first excerpt without a leading copy of the title. The vendor often
 * starts an excerpt with the page title, as a Markdown heading or a plain line.
 */
function excerptSnippet(
  excerpt: string | undefined,
  title: string,
): string | undefined {
  if (excerpt === undefined) return undefined;
  const text = excerpt.trim();
  const [first, ...rest] = text.split(/\r?\n/u);
  if (rest.length === 0) return text;
  const firstLine = (first ?? '').replace(/^#+\s*/u, '').trim();
  return firstLine === title ? rest.join('\n').trim() : text;
}

export function mapParallelResults(payload: ParallelPayload): Array<RawResult> {
  return payload.results.flatMap((value) => {
    const parsed = ParallelResultSchema.safeParse(value);
    if (!parsed.success) return [];
    const { data } = parsed;
    const title = data.title ?? '';
    const snippet = excerptSnippet(data.excerpts?.[0], title);
    return [
      {
        title,
        url: data.url,
        ...(snippet !== undefined && snippet !== '' && { snippet }),
        ...(data.publish_date !== undefined &&
          data.publish_date !== null && { published: data.publish_date }),
      },
    ];
  });
}

function requestBody(
  mode: ParallelSearchMode,
  request: EngineRequest,
  filters: SiteFilters,
) {
  // The vendor ignores exclusions when inclusions exist, so the engine omits
  // them and notes that instead of sending a list the request would drop.
  const skipExclusions = filters.include.length > 0;
  const sourcePolicy = {
    ...(skipExclusions && { include_domains: filters.include }),
    ...(!skipExclusions &&
      filters.exclude.length > 0 && {
        exclude_domains: filters.exclude,
      }),
    ...(request.recency !== undefined && {
      after_date: recencyDate(request.recency),
    }),
  };
  return {
    search_queries: [filters.query || request.query],
    ...(request.objective !== undefined && { objective: request.objective }),
    mode,
    session_id: request.chatId,
    advanced_settings: {
      max_results: vendorCount('parallel', request.limit),
      excerpt_settings: { max_chars_per_result: EXCERPT_MAX_CHARS_PER_RESULT },
      ...(Object.keys(sourcePolicy).length > 0 && {
        source_policy: sourcePolicy,
      }),
    },
  };
}

/** Create a Parallel Search API adapter for one resolved operator engine. */
export function createParallelEngine(
  config: { readonly key: string; readonly mode: ParallelSearchMode },
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const filters = splitSiteFilters(request.query);
    const extra =
      filters.include.length > 0 && filters.exclude.length > 0
        ? { notes: [EXCLUSIONS_NOTE] }
        : {};
    const payload = await fetchVendorJson(
      PARALLEL_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': config.key,
        },
        body: JSON.stringify(requestBody(config.mode, request, filters)),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      ParallelPayloadSchema,
    );
    const results = mapParallelResults(payload);
    return results.length > 0
      ? { kind: 'results', results, ...extra }
      : { kind: 'empty', ...extra };
  };
}
