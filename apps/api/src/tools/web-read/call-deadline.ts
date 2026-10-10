import { isString } from '@workspace/runtime-safety';

import type { WebFetchFailure, WebFetchOptions } from './http-client';

const HEADERS_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const ECHO_BOUND = 64;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const URL_IN_MESSAGE = /https?:\/\//iu;
/** How many `cause` links to follow: undici nests the socket error once or
 *  twice under `fetch failed`. */
const CAUSE_DEPTH = 4;
/** A platform error code is an identifier, safe to echo; anything else is
 *  not a code. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,47}$/u;
const TLS_CODE =
  /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_)|^(?:DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|EPROTO|HOSTNAME_MISMATCH)$/u;
/** The kind of a connection failure, named from its code (#930): the locator
 *  already says which host, so the kind is what tells "this host is down"
 *  from "try again". */
const CONNECTION_FAILURES = new Map([
  ['ECONNREFUSED', 'The server refused the connection.'],
  ['ECONNRESET', 'The connection was reset.'],
  ['EPIPE', 'The connection was reset.'],
  ['UND_ERR_SOCKET', 'The connection was reset.'],
  ['ETIMEDOUT', 'The connection timed out.'],
  ['UND_ERR_CONNECT_TIMEOUT', 'The connection timed out.'],
  ['EHOSTUNREACH', 'The host is unreachable.'],
  ['ENETUNREACH', 'The host is unreachable.'],
]);

export type AbortReason = 'aborted' | 'headers_timeout' | 'call_timeout';

/** One locator's view of the call deadline: the call's bounds plus a header
 *  bound of its own, so a probe that never answers fails only itself. */
export type FetchDeadline = {
  readonly signal: AbortSignal;
  /** Arms the header bound for the request about to be sent. */
  requestStarted(): void;
  /** Clears the header bound once a response has arrived: it bounds the wait
   *  for headers, not the body. */
  headersArrived(): void;
  reason(): AbortReason | undefined;
  dispose(): void;
};

export type CallDeadline = {
  /** Scopes the header bound to one locator and the hops it follows. */
  startFetch(): FetchDeadline;
  dispose(): void;
};

export function abortFailure(reason: AbortReason | undefined): WebFetchFailure {
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

/** The call's abort source, composed of the caller's signal and the call
 *  bound, remembering which one fired first so the failure names it. */
export function startCallDeadline(options: WebFetchOptions): CallDeadline {
  const controller = new AbortController();
  let reason: AbortReason | undefined;
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
    startFetch: () => startFetchDeadline(controller.signal, () => reason),
    dispose: () => {
      clearTimeout(callTimer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

function startFetchDeadline(
  callSignal: AbortSignal,
  callReason: () => AbortReason | undefined,
): FetchDeadline {
  const headers = new AbortController();
  let headersTimedOut = false;
  let headersTimer: NodeJS.Timeout | undefined;
  return {
    signal: AbortSignal.any([callSignal, headers.signal]),
    // Every request of the locator gets the full header bound; a hop may not
    // spend the next request's allowance waiting on this one.
    requestStarted: () => {
      clearTimeout(headersTimer);
      headersTimer = setTimeout(() => {
        // A call bound that fired first keeps its name.
        headersTimedOut = !callSignal.aborted;
        headers.abort();
      }, HEADERS_TIMEOUT_MS);
    },
    headersArrived: () => clearTimeout(headersTimer),
    reason: () => (headersTimedOut ? 'headers_timeout' : callReason()),
    dispose: () => clearTimeout(headersTimer),
  };
}

/** A server-controlled header value echoed into a failure message can be
 *  arbitrarily long and carry control characters, so it is stripped and
 *  bounded before it reaches the model, the rule `rejectedUrl` follows too. */
export function boundedEcho(value: string): string {
  // Strip first: the bound then counts the characters the model will read.
  return value.replace(CONTROL_CHARACTERS, '').slice(0, ECHO_BOUND);
}

/** A transport failure the client did not itself cause: the abort reason when
 *  the call aborted, the failure's kind when its platform code names one, the
 *  cause's own message otherwise — never the whole error object, which can
 *  carry request and header details. The message is stripped and bounded like
 *  every other echo, and one that names a URL is not echoed at all: Node's own
 *  errors embed the request's URL, credentials included. */
export function transportFailure(
  error: unknown,
  deadline: FetchDeadline,
): WebFetchFailure {
  const reason = deadline.reason();
  if (reason !== undefined) return abortFailure(reason);
  const kind = connectionFailureKind(error);
  if (kind !== undefined) return { type: 'network_error', message: kind };
  const message =
    error instanceof Error ? error.message.replace(CONTROL_CHARACTERS, '') : '';
  return {
    type: 'network_error',
    message:
      message === '' || URL_IN_MESSAGE.test(message)
        ? 'The request failed.'
        : message.slice(0, ECHO_BOUND),
  };
}

/** The named kind of the first platform code on the error's `cause` chain.
 *  Only genuine `Error`s are followed, the same trust the message echo
 *  requires; the code itself is echoed only for TLS, where it is the
 *  diagnosis (`CERT_HAS_EXPIRED`), and only when it is an identifier. */
function connectionFailureKind(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) return undefined;
    const code: unknown = 'code' in current ? current.code : undefined;
    if (isString(code) && ERROR_CODE.test(code)) {
      const known = CONNECTION_FAILURES.get(code);
      if (known !== undefined) return known;
      if (TLS_CODE.test(code)) return `The TLS handshake failed (${code}).`;
    }
    current = current.cause;
  }
  return undefined;
}
