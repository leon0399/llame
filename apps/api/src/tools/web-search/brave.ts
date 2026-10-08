import { parseHTML } from 'linkedom';
import { z } from 'zod';
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
  web: z.object({ results: z.array(z.unknown()).optional() }).optional(),
});

type BravePayload = z.infer<typeof BravePayloadSchema>;

function parseBravePayload(body: string): BravePayload {
  // SAFETY: JSON.parse returns any; Zod validates the complete Brave payload.
  return BravePayloadSchema.parse(JSON.parse(body) as unknown);
}

function textContent(value: string): string {
  const document = parseHTML(
    `<!doctype html><html><body>${value}</body></html>`,
  ).document;
  return String(document.body.textContent);
}

function readResults(payload: BravePayload): ReadonlyArray<RawResult> {
  const values = payload.web?.results;
  if (values === undefined) return [];
  return values.flatMap((value) => {
    const result = BraveResultSchema.safeParse(value);
    if (!result.success) return [];
    const { data } = result;
    return [
      {
        title: textContent(data.title),
        url: data.url,
        ...(data.description !== undefined && {
          snippet: textContent(data.description),
        }),
        ...(data.page_age !== undefined && { published: data.page_age }),
      },
    ];
  });
}

/** Create a Brave Search API adapter for one resolved operator engine. */
export function createBraveEngine(
  config: { readonly key: string },
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
      parseBravePayload,
    );
    const results = readResults(payload);
    return results.length === 0
      ? { kind: 'empty' }
      : { kind: 'results', results };
  };
}

export { BRAVE_SEARCH_URL, FRESHNESS_BY_RECENCY };
