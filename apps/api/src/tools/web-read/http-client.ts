export type WebResponse = {
  readonly finalUrl: string;
  readonly contentType: string;
  readonly body: string;
};

export type WebFetchFailure = {
  readonly type: string;
  readonly message: string;
};

export type WebFetchDeps = {
  readonly fetch: typeof globalThis.fetch;
};

type WebFetchOptions = {
  readonly userAgent: string;
  readonly signal?: AbortSignal;
  /** The caller's own deadline for this call, which may tighten the tool's
   *  30-second bound but never extend it. */
  readonly deadlineMs?: number;
};

/** The `Accept` value every request of a web read sends: publisher Markdown
 *  first, plain text ranked above HTML (design D9). */
const ACCEPT = 'text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5';

/** The statuses the redirect requirement governs. This layer refuses them all
 *  in one branch; the `policy` layer replaces that branch with its hop loop. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** The accepted text body set (design D8): `text/*`, `application/json`,
 *  `application/xml`, and any `+json`/`+xml` subtype. */
const TEXT_MEDIA_TYPE = /^text\/|^application\/(?:json|xml)$|\+(?:json|xml)$/u;

/** The `Content-Type` charset parameter, quoted or bare. */
const CHARSET_PARAMETER = /;\s*charset\s*=\s*"?([^";\s]+)"?/iu;

const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/iu;

const HEADERS_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CHARSET_SCAN_BYTES = 2048;

/** A server-controlled header value echoed into a failure message can be
 *  arbitrarily long and carry control characters, so it is stripped and
 *  bounded before it reaches the model, the rule `rejectedUrl` follows too. */
const ECHO_BOUND = 64;
const CONTROL_CHARACTERS = /\p{Cc}/gu;

function boundedEcho(value: string): string {
  // Strip first: the bound then counts the characters the model will read.
  return value.replace(CONTROL_CHARACTERS, '').slice(0, ECHO_BOUND);
}

const BODY_TOO_LARGE: WebFetchFailure = {
  type: 'body_too_large',
  message: 'The response body exceeds the 5 MiB limit.',
};

type AbortReason = 'aborted' | 'headers_timeout' | 'call_timeout';

type CallDeadline = {
  readonly signal: AbortSignal;
  /** Clears the header bound once a response has arrived: it bounds the wait
   *  for headers, not the body. */
  headersArrived(): void;
  reason(): AbortReason | undefined;
  dispose(): void;
};

type ContentType = {
  /** The header as received, with only the media type lowercased. */
  readonly value: string;
  readonly mediaType: string;
};

type BodyOutcome =
  | { readonly kind: 'body'; readonly bytes: Uint8Array }
  | { readonly kind: 'failure'; readonly failure: WebFetchFailure };

type ResponseOutcome =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'failure'; readonly failure: WebFetchFailure };

function abortFailure(reason: AbortReason | undefined): WebFetchFailure {
  if (reason === 'headers_timeout') {
    return {
      type: 'headers_timeout',
      message: 'The server sent no response headers within 10 seconds.',
    };
  }
  if (reason === 'call_timeout') {
    return {
      type: 'call_timeout',
      message: 'The web read exceeded its 30-second budget.',
    };
  }
  return { type: 'aborted', message: 'The web read was cancelled.' };
}

/** The call's single abort source, composed of the caller's signal and the two
 *  bounds, remembering which one fired first so the failure names it. */
function startCallDeadline(options: WebFetchOptions): CallDeadline {
  const controller = new AbortController();
  let reason: AbortReason | undefined;
  const abort = (next: AbortReason): void => {
    reason ??= next;
    controller.abort();
  };
  const onCallerAbort = (): void => abort('aborted');
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const headersTimer = setTimeout(
    () => abort('headers_timeout'),
    HEADERS_TIMEOUT_MS,
  );
  const callTimer = setTimeout(
    () => abort('call_timeout'),
    // A caller with less budget left may tighten this bound, but no caller can
    // extend the 30 seconds the tool guarantees.
    Math.min(options.deadlineMs ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS),
  );
  return {
    signal: controller.signal,
    headersArrived: () => clearTimeout(headersTimer),
    reason: () => reason,
    dispose: () => {
      clearTimeout(headersTimer);
      clearTimeout(callTimer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

/** A transport failure the client did not itself cause: the abort reason when
 *  the call aborted, the cause's own message otherwise — never the whole error
 *  object, which can carry request and header details. */
function transportFailure(
  error: unknown,
  deadline: CallDeadline,
): WebFetchFailure {
  const reason = deadline.reason();
  if (reason !== undefined) return abortFailure(reason);
  return {
    type: 'network_error',
    message: error instanceof Error ? error.message : 'The request failed.',
  };
}

async function requestDocument(
  url: string,
  options: WebFetchOptions,
  deadline: CallDeadline,
  deps: WebFetchDeps,
): Promise<ResponseOutcome> {
  // A caller that has already aborted issues no request at all: an aborted
  // signal never fires its event again.
  if (options.signal?.aborted === true) {
    return { kind: 'failure', failure: abortFailure('aborted') };
  }
  try {
    const response = await deps.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      // No cookie or credential travels with a web read, on this request or
      // any later one.
      credentials: 'omit',
      headers: { accept: ACCEPT, 'user-agent': options.userAgent },
      signal: deadline.signal,
    });
    deadline.headersArrived();
    return { kind: 'response', response };
  } catch (error) {
    return { kind: 'failure', failure: transportFailure(error, deadline) };
  }
}

/** Keeps the parameters as received; only the media type is lowercased for the
 *  allowlist check. */
function contentTypeOf(header: string | null): ContentType {
  if (header === null) return { value: '', mediaType: '' };
  const separator = header.indexOf(';');
  if (separator === -1) {
    const mediaType = header.trim().toLowerCase();
    return { value: mediaType, mediaType };
  }
  const mediaType = header.slice(0, separator).trim().toLowerCase();
  return { value: `${mediaType}${header.slice(separator)}`, mediaType };
}

function unsupportedContentType(contentType: ContentType): WebFetchFailure {
  if (contentType.mediaType === '') {
    return {
      type: 'unsupported_content_type',
      message: 'The response declares no content type.',
    };
  }
  return {
    type: 'unsupported_content_type',
    message: `Unsupported content type "${boundedEcho(contentType.mediaType)}".`,
  };
}

/** A declared length is only ever a hint, so it short-circuits the body read
 *  and nothing else. */
function contentLengthOf(headers: Headers): number | undefined {
  const declared = headers.get('content-length');
  if (declared === null || !/^\d+$/u.test(declared)) return undefined;
  return Number(declared);
}

function statusFailure(status: number, headers: Headers): WebFetchFailure {
  if (REDIRECT_STATUSES.includes(status)) {
    return {
      type: 'http_status',
      message: `The server answered HTTP ${status} with a redirect, which this tool does not follow.`,
    };
  }
  const retryAfter = status === 429 ? headers.get('retry-after') : null;
  if (retryAfter === null || retryAfter === '') {
    return {
      type: 'http_status',
      message: `The server answered HTTP ${status}.`,
    };
  }
  return {
    type: 'http_status',
    message: `The server answered HTTP ${status}; retry after ${boundedEcho(retryAfter)}.`,
  };
}

async function cancelBody(response: Response): Promise<void> {
  const body = response.body;
  if (body === null) return;
  await body.cancel().catch(() => undefined);
}

/** Everything a response is refused for before a byte of its body is read, so
 *  a failure never costs the download it refuses. */
async function refusalFor(
  response: Response,
  contentType: ContentType,
): Promise<WebFetchFailure | undefined> {
  if (!response.ok) {
    await cancelBody(response);
    return statusFailure(response.status, response.headers);
  }
  if (!TEXT_MEDIA_TYPE.test(contentType.mediaType)) {
    await cancelBody(response);
    return unsupportedContentType(contentType);
  }
  const declared = contentLengthOf(response.headers);
  if (declared !== undefined && declared > MAX_BODY_BYTES) {
    await cancelBody(response);
    return BODY_TOO_LARGE;
  }
  return undefined;
}

async function stopReading(
  reader: ReadableStreamDefaultReader<Uint8Array>,
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

/** Streams the body against the 5 MiB cap: the read stops at the first chunk
 *  past it instead of buffering the remainder. A read that is still waiting on
 *  the server when the call aborts resolves as done once the reader is
 *  cancelled, or rejects outright because the transport tore the body down, so
 *  the abort reason, not the truncated body, is what returns. */
async function readAllChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: CallDeadline,
): Promise<BodyOutcome> {
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array>;
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
    total += next.value.byteLength;
    if (total > MAX_BODY_BYTES) return stopReading(reader, BODY_TOO_LARGE);
    chunks.push(next.value);
  }
}

async function readCappedBody(
  response: Response,
  deadline: CallDeadline,
): Promise<BodyOutcome> {
  const body = response.body;
  if (body === null) return { kind: 'body', bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  deadline.signal.addEventListener('abort', onAbort, { once: true });
  if (deadline.signal.aborted) onAbort();
  try {
    return await readAllChunks(reader, deadline);
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
function decodeBody(bytes: Uint8Array, contentType: ContentType): string {
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

/**
 * Fetches one web locator: a single `GET` under the two bounds, with the body
 * streamed against the size cap and decoded to text. Nothing is retried and no
 * redirect is followed; a failure carries a type and a message and never the
 * body it refused.
 */
export async function fetchWebDocument(
  url: string,
  options: WebFetchOptions,
  deps: WebFetchDeps = { fetch: globalThis.fetch },
): Promise<WebResponse | WebFetchFailure> {
  const deadline = startCallDeadline(options);
  try {
    const document = await requestDocument(url, options, deadline, deps);
    if (document.kind === 'failure') return document.failure;
    const response = document.response;
    const contentType = contentTypeOf(response.headers.get('content-type'));
    const refusal = await refusalFor(response, contentType);
    if (refusal !== undefined) return refusal;
    const body = await readCappedBody(response, deadline);
    if (body.kind === 'failure') return body.failure;
    return {
      // The requested URL is the final one while no hop is followed.
      finalUrl: url,
      contentType: contentType.value,
      body: decodeBody(body.bytes, contentType),
    };
  } finally {
    deadline.dispose();
  }
}
