import { type VendorFetch } from './http';

export type CapturedRequest = {
  readonly url: string;
  readonly init?: RequestInit;
};
export type FetchCapture = {
  readonly fetch: VendorFetch;
  readonly seen: () => CapturedRequest;
};

export function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return input;
}

export function jsonResponse(
  body: string,
  status = 200,
  headers: HeadersInit = { 'content-type': 'application/json' },
): Response {
  return new Response(body, { status, headers });
}

export function captureFetch(body: string, status = 200): FetchCapture {
  let captured: CapturedRequest = { url: '' };
  const fetch: VendorFetch = (input, init) => {
    captured = { url: requestUrl(input), init };
    return Promise.resolve(jsonResponse(body, status));
  };
  return { fetch, seen: () => captured };
}
