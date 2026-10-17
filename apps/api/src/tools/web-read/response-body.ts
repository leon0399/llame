import type {
  ReadableStreamDefaultReader,
  ReadableStreamReadResult,
} from 'node:stream/web';

import {
  type Headers as UndiciHeaders,
  type Response as UndiciResponse,
} from 'undici';

import {
  abortFailure,
  transportFailure,
  type FetchDeadline,
} from './call-deadline';
import type { WebFetchFailure } from './http-client';

/** The `Content-Type` charset parameter, quoted or bare. */
const CHARSET_PARAMETER = /;\s*charset\s*=\s*"?([^";\s]+)"?/iu;

const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/iu;

export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const CHARSET_SCAN_BYTES = 2048;

function bodyTooLarge(maxBytes: number): WebFetchFailure {
  return {
    type: 'body_too_large',
    message: `The response body exceeds the ${maxBytes / (1024 * 1024)} MiB limit.`,
  };
}

export type ContentType = {
  /** The header as received, with only the media type lowercased. */
  readonly value: string;
  readonly mediaType: string;
};

/** undici's body is a `node:stream/web` stream, not the DOM one. */
type UndiciBodyReader = ReadableStreamDefaultReader<unknown>;
type BodyOutcome =
  | { readonly kind: 'body'; readonly bytes: Uint8Array }
  | { readonly kind: 'failure'; readonly failure: WebFetchFailure };

/** Keeps the parameters as received; only the media type is lowercased for the
 *  allowlist check. */
export function contentTypeOf(header: string | null): ContentType {
  if (header === null) return { value: '', mediaType: '' };
  const separator = header.indexOf(';');
  if (separator === -1) {
    const mediaType = header.trim().toLowerCase();
    return { value: mediaType, mediaType };
  }
  const mediaType = header.slice(0, separator).trim().toLowerCase();
  return { value: `${mediaType}${header.slice(separator)}`, mediaType };
}

/** A declared length short-circuits the read; streaming enforces the same cap. */
function declaresBodyOverBound(
  headers: UndiciHeaders,
  maxBytes: number,
): boolean {
  const declared = headers.get('content-length');
  if (declared === null || !/^\d+$/u.test(declared)) return false;
  return Number(declared) > maxBytes;
}

export async function cancelBody(response: UndiciResponse): Promise<void> {
  const body = response.body;
  if (body === null) return;
  await body.cancel().catch(() => undefined);
}

async function stopReading(
  reader: UndiciBodyReader,
  failure: WebFetchFailure,
): Promise<BodyOutcome> {
  await reader.cancel().catch(() => undefined);
  return { kind: 'failure', failure };
}

function concatChunks(
  chunks: ReadonlyArray<Uint8Array>,
  total: number,
): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Streams against the response's cap: the read stops at the first chunk
 *  past it instead of buffering the remainder. A read that is still waiting on
 *  the server when the call aborts resolves as done once the reader is
 *  cancelled, or rejects outright because the transport tore the body down, so
 *  the abort reason, not the truncated body, is what returns. */
async function readAllChunks(
  reader: UndiciBodyReader,
  deadline: FetchDeadline,
  maxBytes: number,
): Promise<BodyOutcome> {
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  for (;;) {
    let next: ReadableStreamReadResult<unknown>;
    try {
      next = await reader.read();
    } catch (error) {
      return { kind: 'failure', failure: transportFailure(error, deadline) };
    }
    if (next.done) {
      const reason = deadline.reason();
      if (reason !== undefined) {
        return { kind: 'failure', failure: abortFailure(reason) };
      }
      return { kind: 'body', bytes: concatChunks(chunks, total) };
    }
    const chunk: unknown = next.value;
    if (!(chunk instanceof Uint8Array)) {
      return stopReading(
        reader,
        transportFailure(
          new TypeError('The response body was invalid.'),
          deadline,
        ),
      );
    }
    total += chunk.byteLength;
    if (total > maxBytes) return stopReading(reader, bodyTooLarge(maxBytes));
    chunks.push(chunk);
  }
}

export async function readCappedBody(
  response: UndiciResponse,
  deadline: FetchDeadline,
  maxBytes: number,
): Promise<BodyOutcome> {
  if (declaresBodyOverBound(response.headers, maxBytes)) {
    await cancelBody(response);
    return { kind: 'failure', failure: bodyTooLarge(maxBytes) };
  }
  const body = response.body;
  if (body === null) return { kind: 'body', bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  deadline.signal.addEventListener('abort', onAbort, { once: true });
  if (deadline.signal.aborted) onAbort();
  try {
    return await readAllChunks(reader, deadline, maxBytes);
  } finally {
    deadline.signal.removeEventListener('abort', onAbort);
  }
}

/** A `<meta charset>` declaration is ASCII by construction, so the scan window
 *  decodes as Latin-1 whatever charset the body itself declares. */
function charsetFromMeta(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(
    bytes.subarray(0, CHARSET_SCAN_BYTES),
  );
  return META_CHARSET.exec(head)?.[1];
}

/** Charset resolution: the `Content-Type` parameter, then a `<meta charset>`
 *  in the first 2 KiB, then UTF-8. An unknown label is not a reason to lose
 *  the body, so it falls back to UTF-8 rather than failing the read. */
export function decodeBody(
  bytes: Uint8Array,
  contentType: ContentType,
): string {
  const label =
    CHARSET_PARAMETER.exec(contentType.value)?.[1] ??
    charsetFromMeta(bytes) ??
    'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
