import { z } from 'zod';
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

async function fetchVendorText(
  url: string,
  init: RequestInit,
  options: VendorFetchOptions,
  accepts: (mediaType: string | undefined) => boolean,
): Promise<string> {
  const response = await fetchResponse(url, init, options);
  await classifyStatus(response);
  options.signal.throwIfAborted();
  const contentType = response.headers.get('content-type');
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
  if (!accepts(mediaType)) {
    await response.body?.cancel().catch(() => undefined);
    throw new EngineFailure('upstream_error');
  }
  try {
    return await response.text();
  } catch {
    options.signal.throwIfAborted();
    throw new EngineFailure('upstream_error');
  }
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
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await fetchVendorText(
    url,
    init,
    options,
    (mediaType) =>
      mediaType === 'application/json' ||
      (mediaType?.includes('/') === true && mediaType.endsWith('+json')),
  );
  try {
    // SAFETY: JSON.parse returns any; the supplied Zod schema validates it.
    return schema.parse(JSON.parse(body) as unknown);
  } catch {
    options.signal.throwIfAborted();
    throw new EngineFailure('upstream_error');
  }
}

/** Fetch one bounded vendor HTML response without exposing its body. */
export async function fetchVendorHtml(
  url: string,
  init: RequestInit,
  options: VendorFetchOptions,
): Promise<string> {
  return fetchVendorText(
    url,
    init,
    options,
    (mediaType) => mediaType === 'text/html',
  );
}
