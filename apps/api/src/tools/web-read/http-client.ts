import { REJECTED_HOP_MESSAGE, rejectedHopUrl } from '../permissions/messages';
import { type AdmitDerivedLocator } from './admission';

export type WebResponse = {
  readonly finalUrl: string;
  readonly contentType: string;
  readonly body: string;
  /** The final response's `Link` header as received, when it sent one; the
   *  alternate adapter parses it. */
  readonly link?: string;
};

export type WebFetchFailure = {
  readonly type: string;
  readonly message: string;
  /** A refused hop's locator, origin and path only, bounded and stripped;
   *  present on `permission_denied` and nothing else. */
  readonly rejectedUrl?: string;
};

export type WebFetchDeps = {
  readonly fetch: typeof globalThis.fetch;
  /**
   * Admission for every locator this client derives rather than receives:
   * a redirect hop is put through it before its request, exactly as the
   * submitted locator was put through the call's own decision.
   */
  readonly admit: AdmitDerivedLocator;
};

export type WebFetchOptions = {
  readonly userAgent: string;
  readonly signal?: AbortSignal;
  /** The caller's own deadline for this call, which may tighten the tool's
   *  30-second bound but never extend it. */
  readonly deadlineMs?: number;
};

/**
 * One call's requests: a single deadline over all of them (design D7's 30
 * seconds, counted across every request the call issues) and a single redirect
 * budget shared with the pipeline's probes, so the hops a probe follows count
 * against the same 20 the first request may use.
 */
export type WebFetchSession = {
  /** Fetches one locator, following its redirects, inside the call's budget. */
  readonly fetch: (url: string) => Promise<WebResponse | WebFetchFailure>;
  /** Releases the call's timers and its listener on the caller's signal. */
  readonly dispose: () => void;
};

/** The `Accept` value every request of a web read sends: publisher Markdown
 *  first, plain text ranked above HTML (design D9). */
const ACCEPT = 'text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5';

/** The statuses the redirect requirement governs; every other non-2xx status
 *  fails the call with `http_status`, `Location` or not. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** The hops one call may follow, across every request it issues (design D7). */
const MAX_REDIRECTS = 20;

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

/** Neither message names the target: a `Location` is server-chosen text. */
const INVALID_REDIRECT: WebFetchFailure = {
  type: 'invalid_redirect',
  message: 'The server answered with a redirect this tool cannot follow.',
};

const TOO_MANY_REDIRECTS: WebFetchFailure = {
  type: 'too_many_redirects',
  message: 'The server redirected more than the 20 hops one call may follow.',
};

type AbortReason = 'aborted' | 'headers_timeout' | 'call_timeout';

type CallDeadline = {
  readonly signal: AbortSignal;
  /** Arms the header bound for the request about to be sent. */
  requestStarted(): void;
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

/** A redirect resolved to the locator policy will see, or the refusal it fails
 *  the call with. */
type HopResolution =
  | { readonly url: string }
  | { readonly failure: WebFetchFailure };

type CallBudget = {
  readonly deadline: CallDeadline;
  /** Hops followed so far, across every request of the call. */
  redirects: number;
};

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
  let headersTimer: NodeJS.Timeout | undefined;
  const abort = (next: AbortReason): void => {
    reason ??= next;
    controller.abort();
  };
  const onCallerAbort = (): void => abort('aborted');
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const callTimer = setTimeout(
    () => abort('call_timeout'),
    // A caller with less budget left may tighten this bound, but no caller can
    // extend the 30 seconds the tool guarantees.
    Math.min(options.deadlineMs ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS),
  );
  return {
    signal: controller.signal,
    // Every request of the call gets the full header bound; a hop may not
    // spend the next request's allowance waiting on this one.
    requestStarted: () => {
      clearTimeout(headersTimer);
      headersTimer = setTimeout(
        () => abort('headers_timeout'),
        HEADERS_TIMEOUT_MS,
      );
    },
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
  deadline.requestStarted();
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

/**
 * The hop locator: the `Location` value resolved against the redirecting
 * request's URL by the WHATWG parser and serialized as its `href`, so a
 * relative `Location` becomes absolute and policy sees the canonical text the
 * next request uses. A fragment never leaves the process, so it is dropped
 * rather than refused: the text policy matches is then exactly the URL the
 * request uses — an allow anchored on the path still admits the page — while a
 * server's ordinary `Location: /guide#section` still leads there. A redirect
 * the tool cannot follow — no parsable `Location`, userinfo, or a scheme other
 * than `http`/`https` — fails closed without naming the target.
 */
function hopLocator(base: string, location: string | null): HopResolution {
  if (location === null || location.trim() === '') {
    return { failure: INVALID_REDIRECT };
  }
  let resolved: URL;
  try {
    resolved = new URL(location, base);
  } catch {
    return { failure: INVALID_REDIRECT };
  }
  if (
    resolved.username !== '' ||
    resolved.password !== '' ||
    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')
  ) {
    return { failure: INVALID_REDIRECT };
  }
  // An empty fragment setter drops the `#` delimiter with it, so a bare `#`
  // leaves no trace either.
  resolved.hash = '';
  return { url: resolved.href };
}

/** What one redirect response leaves the call with: the locator to fetch next,
 *  or the failure that ends the call. */
type HopOutcome =
  | { readonly next: string }
  | { readonly failure: WebFetchFailure };

/** Handles one redirect response: the hop it names is resolved, then refused
 *  when the call's budget is spent or the `read` group rejects it. A refused
 *  hop's target is never requested, so its body is never read. */
async function followRedirect(
  response: Response,
  base: string,
  deps: WebFetchDeps,
  budget: CallBudget,
): Promise<HopOutcome> {
  const hop = hopLocator(base, response.headers.get('location'));
  // The redirect's own body is never content: the locator it names is.
  await cancelBody(response);
  if ('failure' in hop) return { failure: hop.failure };
  if (budget.redirects >= MAX_REDIRECTS) return { failure: TOO_MANY_REDIRECTS };
  if (deps.admit('hop', hop.url).decision === 'reject') {
    // The fixed message names no target; the locator's origin and path travel
    // beside it, bounded and stripped.
    return {
      failure: {
        type: 'permission_denied',
        message: REJECTED_HOP_MESSAGE,
        rejectedUrl: rejectedHopUrl(hop.url),
      },
    };
  }
  budget.redirects += 1;
  return { next: hop.url };
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
 * Starts one call's fetch session: every locator fetched through it shares the
 * call's deadline and its redirect budget, so the 30-second bound and the 20
 * hops hold across the first request, every hop, and every probe the pipeline
 * issues. Nothing is retried; a failure carries a type and a message and never
 * the body it refused.
 */
export function createWebFetchSession(
  options: WebFetchOptions,
  deps: WebFetchDeps,
): WebFetchSession {
  const budget: CallBudget = {
    deadline: startCallDeadline(options),
    redirects: 0,
  };
  return {
    fetch: (url) => fetchLocator(url, options, deps, budget),
    dispose: () => budget.deadline.dispose(),
  };
}

/** Fetches one locator and the hops it answers with. A redirect status is
 *  followed only when the hop it names parses, the call still has redirect
 *  budget, and the `read` group admits that locator; a refused hop ends the
 *  call without its target's body ever being read. */
async function fetchLocator(
  url: string,
  options: WebFetchOptions,
  deps: WebFetchDeps,
  budget: CallBudget,
): Promise<WebResponse | WebFetchFailure> {
  let locator = url;
  for (;;) {
    const outcome = await requestDocument(
      locator,
      options,
      budget.deadline,
      deps,
    );
    if (outcome.kind === 'failure') return outcome.failure;
    const response = outcome.response;
    if (REDIRECT_STATUSES.includes(response.status)) {
      const hop = await followRedirect(response, locator, deps, budget);
      if ('failure' in hop) return hop.failure;
      locator = hop.next;
      continue;
    }
    const contentType = contentTypeOf(response.headers.get('content-type'));
    const refusal = await refusalFor(response, contentType);
    if (refusal !== undefined) return refusal;
    const body = await readCappedBody(response, budget.deadline);
    if (body.kind === 'failure') return body.failure;
    const fetched: WebResponse = {
      // The URL of the response that produced this content, after every hop
      // the call followed.
      finalUrl: locator,
      contentType: contentType.value,
      body: decodeBody(body.bytes, contentType),
    };
    // The final response's own `Link` header, and nothing from a response the
    // call followed away from.
    const link = response.headers.get('link');
    return link === null ? fetched : { ...fetched, link };
  }
}
