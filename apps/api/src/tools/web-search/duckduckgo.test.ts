import { describe, expect, it } from 'vitest';
import { createDuckDuckGoEngine, DUCKDUCKGO_SEARCH_URL } from './duckduckgo';
import { type EngineOutcome, type EngineRequest } from './chain';
import { type VendorFetch } from './http';
import { requestUrl } from '../../testing/web-search-fetch';
const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'site:example.test cats',
  recency: 'week',
  limit: 7,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  ...overrides,
});
const response = (
  body: string,
  status = 200,
  headers: HeadersInit = { 'content-type': 'text/html; charset=UTF-8' },
): Response => new Response(body, { status, headers });
const html = (results: string): string =>
  `<html><body>${results}</body></html>`;

function formFrom(init: RequestInit | undefined): URLSearchParams {
  if (!(init?.body instanceof URLSearchParams))
    throw new TypeError('expected URLSearchParams request body');
  return init.body;
}

const firstResult = `
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Ffirst%3Fx%3D1&amp;rut=ignored">First result</a>
    <div class="result__snippet">First <b>snippet</b></div>
  </div>
`;

async function runWith(
  body: string,
  overrides: Partial<EngineRequest> = {},
  fetchResponse = response,
): Promise<{ output: EngineOutcome; init?: RequestInit; url: string }> {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const fetch: VendorFetch = (input, init) => {
    seenUrl = requestUrl(input);
    seenInit = init;
    return Promise.resolve(fetchResponse(body));
  };
  const output = await createDuckDuckGoEngine({ fetch })(request(overrides));
  return { output, init: seenInit, url: seenUrl };
}

describe('DuckDuckGo HTML engine', () => {
  it('posts the encoded query and maps results from HTML', async () => {
    const { output, init, url } = await runWith(html(firstResult));
    const form = formFrom(init);
    expect(url).toBe(DUCKDUCKGO_SEARCH_URL);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/html');
    expect(headers.get('Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(headers.get('User-Agent')).toBe('llame/test');
    expect(form.get('q')).toBe('site:example.test cats');
    expect(form.get('df')).toBe('w');
    expect(output).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'First result',
          url: 'https://example.test/first?x=1',
          snippet: 'First snippet',
        },
      ],
    });
  });

  it.each([
    ['day', 'd'],
    ['week', 'w'],
    ['month', 'm'],
    ['year', 'y'],
  ] as const)('maps %s recency to %s', async (recency, expected) => {
    const { init } = await runWith(html(''), { recency });
    expect(formFrom(init).get('df')).toBe(expected);
  });

  it('omits the date filter when recency is unset', async () => {
    const { init } = await runWith(html(''), { recency: undefined });
    const form = formFrom(init);
    expect(form.get('q')).toBe('site:example.test cats');
    expect(form.has('df')).toBe(false);
  });

  it('skips ads without applying the output limit', async () => {
    const body = html(`
      ${firstResult}
      <div class="result result--ad">
        <a class="result__a" href="https://ads.example.test/">Ad</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.test/second">Second</a>
        <div class="result__snippet">Second snippet</div>
      </div>
    `);
    const { output } = await runWith(body, { limit: 1 });
    expect(output).toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'First result',
          url: 'https://example.test/first?x=1',
          snippet: 'First snippet',
        },
        {
          title: 'Second',
          url: 'https://example.test/second',
          snippet: 'Second snippet',
        },
      ],
    });
  });

  it('skips entries without links and omits missing snippets', async () => {
    const body = html(`
      <div class="result"><span>Not a link</span></div>
      <div class="result">
        <a class="result__a" href="https://example.test/only">Only result</a>
      </div>
    `);
    const { output } = await runWith(body);
    expect(output).toStrictEqual({
      kind: 'results',
      results: [{ title: 'Only result', url: 'https://example.test/only' }],
    });
  });

  it('returns empty for a page without result entries', async () => {
    await expect(runWith(html(''))).resolves.toMatchObject({
      output: { kind: 'empty' },
    });
  });

  it('classifies a challenge page', async () => {
    const engine = createDuckDuckGoEngine({
      fetch: () =>
        Promise.resolve(
          response('<div class="anomaly-modal">verify</div>', 202),
        ),
    });
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'challenge',
    });
  });

  it('classifies a non-HTML response as an upstream error', async () => {
    const engine = createDuckDuckGoEngine({
      fetch: () =>
        Promise.resolve(
          response('{}', 200, { 'content-type': 'application/json' }),
        ),
    });
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
  });

  it('cancels a non-HTML body before rejecting', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const engine = createDuckDuckGoEngine({
      fetch: () =>
        Promise.resolve(
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
    expect(cancelled).toBe(true);
  });

  it('classifies a rate limit response', async () => {
    const engine = createDuckDuckGoEngine({
      fetch: () => Promise.resolve(response('', 429)),
    });
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'rate_limited',
    });
  });
});
