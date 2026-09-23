import type { ReadableStreamDefaultReader } from 'node:stream/web';

import {
  fetch as undiciFetch,
  type Headers as UndiciHeaders,
  type Response as UndiciResponse,
} from 'undici';

import {
  abortFailure,
  boundedEcho,
  startCallDeadline,
  transportFailure,
  type CallDeadline,
} from './call-deadline';
import { createConnectionPlanner, type ConnectionPlanner } from './connection';
import {
  REJECTED_ADDRESS_MESSAGE,
  REJECTED_HOP_MESSAGE,
  rejectedHopUrl,
} from '../permissions/messages';
import { type AdmitAddress, type AdmitDerivedLocator } from './admission';
import { canonicalHref } from './locator';

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

export type ResolvedAddress = {
  readonly address: string;
  readonly family: 4 | 6;
};

export type ResolveHost = (
  hostname: string,
) => Promise<ReadonlyArray<ResolvedAddress>>;

export type WebFetchDeps = {
  readonly fetch: typeof undiciFetch;
  /** Admission for locators derived from responses and page content. */
  readonly admit: AdmitDerivedLocator;
  /** Reject-only admission for each address locator before dispatch. */
  readonly admitAddress: AdmitAddress;
  /** One call's memoized system-resolution seam. */
  readonly resolve: ResolveHost;
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
  /** Releases the deadline, caller listener, and per-request agents. */
  readonly dispose: () => void;
};

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

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CHARSET_SCAN_BYTES = 2048;

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

type ContentType = {
  /** The header as received, with only the media type lowercased. */
  readonly value: string;
  readonly mediaType: string;
};

/** undici's body is a `node:stream/web` stream, not the DOM one. */
type UndiciBodyReader = ReadableStreamDefaultReader<unknown>;
type BodyOutcome =
  | { readonly kind: 'body'; readonly bytes: Uint8Array }
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

type FetchLocatorContext = {
  readonly options: WebFetchOptions;
  readonly deps: WebFetchDeps;
  readonly budget: CallBudget;
  readonly connections: ConnectionPlanner;
};

function addressRefusal(
  originalUrl: string,
  refusedLocator: string,
): WebFetchFailure {
  const failure: WebFetchFailure = {
    type: 'permission_denied',
    message: REJECTED_ADDRESS_MESSAGE,
  };
  if (refusedLocator === originalUrl) return failure;
  return { ...failure, rejectedUrl: rejectedHopUrl(refusedLocator) };
}

async function readDocumentResponse(
  response: UndiciResponse,
  locator: string,
  deadline: CallDeadline,
): Promise<WebResponse | WebFetchFailure> {
  const contentType = contentTypeOf(response.headers.get('content-type'));
  const refusal = await refusalFor(response, contentType);
  if (refusal !== undefined) return refusal;
  const body = await readCappedBody(response, deadline);
  if (body.kind === 'failure') return body.failure;
  const fetched: WebResponse = {
    finalUrl: locator,
    contentType: contentType.value,
    body: decodeBody(body.bytes, contentType),
  };
  const link = response.headers.get('link');
  return link === null ? fetched : { ...fetched, link };
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
  return { url: canonicalHref(resolved) };
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
  response: UndiciResponse,
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
function contentLengthOf(headers: UndiciHeaders): number | undefined {
  const declared = headers.get('content-length');
  if (declared === null || !/^\d+$/u.test(declared)) return undefined;
  return Number(declared);
}

function statusFailure(
  status: number,
  headers: UndiciHeaders,
): WebFetchFailure {
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

async function cancelBody(response: UndiciResponse): Promise<void> {
  const body = response.body;
  if (body === null) return;
  await body.cancel().catch(() => undefined);
}

/** Everything a response is refused for before a byte of its body is read, so
 *  a failure never costs the download it refuses. */
async function refusalFor(
  response: UndiciResponse,
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

/** Streams the body against the 5 MiB cap: the read stops at the first chunk
 *  past it instead of buffering the remainder. A read that is still waiting on
 *  the server when the call aborts resolves as done once the reader is
 *  cancelled, or rejects outright because the transport tore the body down, so
 *  the abort reason, not the truncated body, is what returns. */
async function readAllChunks(
  reader: UndiciBodyReader,
  deadline: CallDeadline,
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
    if (total > MAX_BODY_BYTES) return stopReading(reader, BODY_TOO_LARGE);
    chunks.push(chunk);
  }
}

async function readCappedBody(
  response: UndiciResponse,
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
  const connections = createConnectionPlanner(deps);
  return {
    fetch: (url) => fetchLocator(url, { options, deps, budget, connections }),
    dispose: () => {
      budget.deadline.dispose();
      connections.dispose();
    },
  };
}

/** Fetches one locator and the hops it answers with. A redirect status is
 *  followed only when the hop it names parses, the call still has redirect
 *  budget, and the `read` group admits that locator; a refused hop ends the
 *  call without its target's body ever being read. */
async function fetchLocator(
  url: string,
  context: FetchLocatorContext,
): Promise<WebResponse | WebFetchFailure> {
  let locator = url;
  for (;;) {
    const outcome = await context.connections.request(
      locator,
      context.options,
      context.budget.deadline,
    );
    if (outcome.kind === 'failure') return outcome.failure;
    if (outcome.kind === 'address_refused') {
      return addressRefusal(url, outcome.locator);
    }
    const response = outcome.response;
    if (REDIRECT_STATUSES.includes(response.status)) {
      const hop = await followRedirect(
        response,
        locator,
        context.deps,
        context.budget,
      );
      if ('failure' in hop) return hop.failure;
      locator = hop.next;
      continue;
    }
    return readDocumentResponse(response, locator, context.budget.deadline);
  }
}
