import { parseHTML } from 'linkedom';
import {
  EngineFailure,
  type Engine,
  type EngineRequest,
  type RawResult,
} from './chain';
import { fetchVendorHtml, type VendorFetch } from './http';

export const DUCKDUCKGO_SEARCH_URL = 'https://html.duckduckgo.com/html/';
export const DUCKDUCKGO_RECENCY: Readonly<
  Record<NonNullable<EngineRequest['recency']>, string>
> = {
  day: 'd',
  week: 'w',
  month: 'm',
  year: 'y',
};
const DUCKDUCKGO_REDIRECT_PREFIX = '//duckduckgo.com/l/?';

function unwrapRedirect(href: string): string {
  if (!href.startsWith(DUCKDUCKGO_REDIRECT_PREFIX)) return href;
  const target = new URL(`https:${href}`).searchParams.get('uddg');
  return target ?? href;
}

function parseResults(body: string): ReadonlyArray<RawResult> {
  const { document } = parseHTML(body);
  return Array.from(document.querySelectorAll('.result')).flatMap((result) => {
    if (result.classList.contains('result--ad')) return [];
    const anchor = result.querySelector('a.result__a');
    const href = anchor?.getAttribute('href');
    if (anchor === null || href === null || href === undefined) return [];
    const snippet = result.querySelector('.result__snippet');
    return [
      {
        title: anchor.textContent?.trim() ?? '',
        url: unwrapRedirect(href),
        ...(snippet !== null && { snippet: snippet.textContent?.trim() ?? '' }),
      },
    ];
  });
}

/** Create a keyless DuckDuckGo HTML search adapter. */
export function createDuckDuckGoEngine(
  _config: { readonly type?: 'duckduckgo' },
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const formBody = new URLSearchParams({ q: request.query });
    if (request.recency !== undefined)
      formBody.set('df', DUCKDUCKGO_RECENCY[request.recency]);
    const htmlBody = await fetchVendorHtml(
      DUCKDUCKGO_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody,
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
    );
    if (htmlBody.includes('anomaly-modal'))
      throw new EngineFailure('challenge');
    const results = parseResults(htmlBody).slice(0, request.limit);
    return results.length > 0
      ? { kind: 'results', results }
      : { kind: 'empty' };
  };
}
