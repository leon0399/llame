import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from '@workspace/runtime-safety';
import { EngineFailure } from './chain';

export const VENDOR_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;
export type VendorJson =
  | null
  | boolean
  | number
  | string
  | Array<VendorJson>
  | { readonly [key: string]: VendorJson };
export type VendorFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type VendorFetchOptions = {
  readonly signal: AbortSignal;
  readonly fetch: VendorFetch;
  readonly userAgent?: string;
};

function isVendorJson(value: unknown): value is VendorJson {
  if (value === null || isString(value) || isNumber(value) || isBoolean(value))
    return true;
  if (Array.isArray(value)) return value.every(isVendorJson);
  return isRecord(value) && Object.values(value).every(isVendorJson);
}

function classifyStatus(status: number): void {
  if (status >= 300 && status < 400) throw new EngineFailure('upstream_error');
  if (status === 401 || status === 403) throw new EngineFailure('auth');
  if (status === 429) throw new EngineFailure('rate_limited');
  if (status < 200 || status >= 300) throw new EngineFailure('upstream_error');
}

async function readStreamBody(
  response: Response,
  signal: AbortSignal,
  cap: AbortController,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted)
        throw (
          signal.reason ??
          new DOMException('The request was aborted.', 'AbortError')
        );
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > VENDOR_RESPONSE_MAX_BYTES) {
        cap.abort();
        await reader.cancel();
        throw new EngineFailure('upstream_error');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readCappedBody(
  response: Response,
  signal: AbortSignal,
  cap: AbortController,
): Promise<string> {
  if (signal.aborted)
    throw (
      signal.reason ??
      new DOMException('The request was aborted.', 'AbortError')
    );
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > VENDOR_RESPONSE_MAX_BYTES)
      throw new EngineFailure('upstream_error');
    return new TextDecoder().decode(bytes);
  }
  return readStreamBody(response, signal, cap);
}

async function fetchResponse(
  url: string,
  init: RequestInit,
  options: VendorFetchOptions,
  signal: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (options.userAgent !== undefined)
    headers.set('User-Agent', options.userAgent);
  try {
    return await options.fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason ?? error;
    throw new EngineFailure('upstream_error');
  }
}

/** Fetch and parse one bounded vendor JSON response without exposing its body. */
export async function fetchVendorJson(
  url: string,
  init: RequestInit,
  options: VendorFetchOptions,
): Promise<VendorJson> {
  const cap = new AbortController(),
    signal = AbortSignal.any([options.signal, cap.signal]);
  const response = await fetchResponse(url, init, options, signal);
  classifyStatus(response.status);
  const declared = response.headers.get('content-length'),
    length = declared === null ? 0 : Number.parseInt(declared, 10);
  if (Number.isFinite(length) && length > VENDOR_RESPONSE_MAX_BYTES) {
    cap.abort();
    throw new EngineFailure('upstream_error');
  }
  let body: string;
  try {
    body = await readCappedBody(response, signal, cap);
  } catch (error) {
    if (error instanceof EngineFailure) throw error;
    if (options.signal.aborted) throw options.signal.reason ?? error;
    throw new EngineFailure('upstream_error');
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isVendorJson(parsed)) throw new Error('invalid JSON value');
    return parsed;
  } catch {
    throw new EngineFailure('upstream_error');
  }
}
