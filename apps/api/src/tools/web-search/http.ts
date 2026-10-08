import { createMcpBoundedFetch } from '../../mcp/mcp-bounded-fetch';
import { EngineFailure } from './chain';

export const VENDOR_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;
export type VendorFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type VendorFetchOptions = {
  readonly signal: AbortSignal;
  readonly fetch: VendorFetch;
  readonly userAgent?: string;
};

async function classifyStatus(response: Response): Promise<void> {
  if (response.status >= 200 && response.status < 300) return;
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403)
    throw new EngineFailure('auth');
  if (response.status === 429) throw new EngineFailure('rate_limited');
  throw new EngineFailure('upstream_error');
}

async function fetchResponse(
  url: string,
  init: RequestInit,
  options: VendorFetchOptions,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (options.userAgent !== undefined)
    headers.set('User-Agent', options.userAgent);
  options.signal.throwIfAborted();
  const boundedFetch = createMcpBoundedFetch({
    fetch: options.fetch,
    maxResponseBytes: VENDOR_RESPONSE_MAX_BYTES,
  });
  try {
    return await boundedFetch(url, {
      ...init,
      headers,
      signal: options.signal,
    });
  } catch {
    options.signal.throwIfAborted();
    throw new EngineFailure('upstream_error');
  }
}

/** Fetch and parse one bounded vendor JSON response without exposing its body. */
export async function fetchVendorJson<T>(
  url: string,
  init: RequestInit,
  options: VendorFetchOptions,
  parse: (body: string) => T,
): Promise<T> {
  const response = await fetchResponse(url, init, options);
  await classifyStatus(response);
  options.signal.throwIfAborted();
  try {
    const body = await response.text();
    return parse(body);
  } catch {
    options.signal.throwIfAborted();
    throw new EngineFailure('upstream_error');
  }
}
