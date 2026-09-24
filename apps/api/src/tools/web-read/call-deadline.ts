import type { WebFetchFailure, WebFetchOptions } from './http-client';

const HEADERS_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const ECHO_BOUND = 64;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const URL_IN_MESSAGE = /https?:\/\//iu;

export type AbortReason = 'aborted' | 'headers_timeout' | 'call_timeout';

export type CallDeadline = {
  readonly signal: AbortSignal;
  /** Arms the header bound for the request about to be sent. */
  requestStarted(): void;
  /** Clears the header bound once a response has arrived: it bounds the wait
   *  for headers, not the body. */
  headersArrived(): void;
  reason(): AbortReason | undefined;
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

/** The call's single abort source, composed of the caller's signal and the two
 *  bounds, remembering which one fired first so the failure names it. */
export function startCallDeadline(options: WebFetchOptions): CallDeadline {
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

/** A server-controlled header value echoed into a failure message can be
 *  arbitrarily long and carry control characters, so it is stripped and
 *  bounded before it reaches the model, the rule `rejectedUrl` follows too. */
export function boundedEcho(value: string): string {
  // Strip first: the bound then counts the characters the model will read.
  return value.replace(CONTROL_CHARACTERS, '').slice(0, ECHO_BOUND);
}

/** A transport failure the client did not itself cause: the abort reason when
 *  the call aborted, the cause's own message otherwise — never the whole error
 *  object, which can carry request and header details. The message is stripped
 *  and bounded like every other echo, and one that names a URL is not echoed at
 *  all: Node's own errors embed the request's URL, credentials included. */
export function transportFailure(
  error: unknown,
  deadline: CallDeadline,
): WebFetchFailure {
  const reason = deadline.reason();
  if (reason !== undefined) return abortFailure(reason);
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
