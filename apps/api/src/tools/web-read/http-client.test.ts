import { getEventListeners } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { REJECTED_HOP_MESSAGE } from '../permissions/messages';
import { type PermissionDecision } from '../permissions/types';
import { createDerivedAdmission, type AdmitDerivedLocator } from './admission';
import { createWebFetchSession } from './http-client';
import type {
  WebFetchFailure,
  WebFetchOptions,
  WebResponse,
} from './http-client';

const URL_ = 'https://docs.example.test/guides/adapter-pipelines.html';
const USER_AGENT = 'llame/1.2.3';
const CAP_BYTES = 5 * 1024 * 1024;

/** The transport and admission a test binds. `admit` defaults to the
 *  fail-closed refusal, so a test that redirects without meaning to gets a
 *  refusal rather than a request to the target. */
type TestDeps = {
  readonly fetch: typeof globalThis.fetch;
  readonly admit?: AdmitDerivedLocator;
};

const ALLOW: PermissionDecision = {
  policyId: 'test-policy',
  decision: 'allow',
  reason: 'matched_allow',
  reference: null,
};

const REFUSE: PermissionDecision = {
  policyId: 'test-policy',
  decision: 'reject',
  reason: 'no_allow',
  reference: null,
};

const refuseEveryHop: AdmitDerivedLocator = () => REFUSE;

/**
 * One locator in a call of its own: the session API with its timers and its
 * listener on the caller's signal released once the fetch resolves. A test
 * that needs one budget across several locators drives the session directly.
 */
async function fetchOne(
  deps: TestDeps,
  options: Partial<WebFetchOptions> = {},
  url = URL_,
): Promise<WebResponse | WebFetchFailure> {
  const session = createWebFetchSession(
    { userAgent: USER_AGENT, ...options },
    { fetch: deps.fetch, admit: deps.admit ?? refuseEveryHop },
  );
  try {
    return await session.fetch(url);
  } finally {
    session.dispose();
  }
}

/** The request's own abort signal: the client always sends one, and it is the
 *  only handle a test has on what the client does with that signal. */
function signalOf(init: RequestInit | undefined): AbortSignal {
  const signal = init?.signal;
  if (signal === null || signal === undefined) {
    throw new Error('the client sent no request signal');
  }
  return signal;
}

/** How many `abort` listeners a signal carries, or `-1` when the test never
 *  saw the signal, so a missing capture fails an assertion rather than
 *  passing one. */
function abortListeners(signal: AbortSignal | undefined): number {
  if (signal === undefined) return -1;
  return getEventListeners(signal, 'abort').length;
}

/** A transport double for one scripted response. `fetch` is a spy, so a test
 *  can prove the client asked exactly once: nothing is retried. */
function serving(response: Response) {
  const fetch = vi.fn(() => Promise.resolve(response));
  return { fetch } satisfies TestDeps;
}

/** A transport that answers each request from a script keyed by its URL. */
function routing(
  route: (url: string, count: number) => Response,
  admit: AdmitDerivedLocator = refuseEveryHop,
) {
  const seen: Array<string> = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    return Promise.resolve(route(url, seen.length));
  });
  return { fetch, admit, seen } satisfies TestDeps & { seen: Array<string> };
}

/** A redirect naming `location`, with no body to read. */
function redirectResponse(status: number, location?: string): Response {
  const headers = new Headers();
  if (location !== undefined) headers.set('location', location);
  return new Response(null, { status, headers });
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, { headers: { 'content-type': contentType } });
}

/** The `<meta charset>` declaration behind `pad` bytes of head padding, so a
 *  test can put it on either side of the 2 KiB scan window. */
function metaCharsetHtml(pad: number): string {
  const head = `<html><head><!--${'x'.repeat(pad)}-->`;
  return `${head}<meta charset="iso-8859-1"></head><body>café</body></html>`;
}

/** A streamed body: `pull` hands over the next chunk and, once the script is
 *  exhausted, never settles — the server holds the connection open, so the
 *  only way to end this body is the client's own cancel or abort. */
function streamingResponse(
  chunks: ReadonlyArray<Uint8Array>,
  init: ResponseInit,
  onCancel: () => void,
): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) return new Promise<void>(() => undefined);
        controller.enqueue(chunk);
        return undefined;
      },
      cancel: onCancel,
    }),
    init,
  );
}

/** A transport that accepts the connection and answers nothing at all. */
function silentFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener(
      'abort',
      () => reject(new Error('the request was aborted')),
      { once: true },
    );
  });
}

/** One scripted request: a response after `afterMs`, or no response at all
 *  while the server holds the connection open. */
type DelayedStep =
  | {
      readonly kind: 'answer';
      readonly afterMs: number;
      readonly respond: () => Response;
    }
  | { readonly kind: 'silent' };

/** A transport that answers each request from its script, one step per
 *  request, and rejects like a real one when the call aborts while a request
 *  is in flight — so a bound that fires mid-wait is what ends the call. */
function delayedRouting(script: ReadonlyArray<DelayedStep>) {
  const seen: Array<string> = [];
  const fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const url = input instanceof Request ? input.url : String(input);
      seen.push(url);
      const step = script[seen.length - 1];
      if (step === undefined) {
        reject(new Error(`the transport has no script for ${url}`));
        return;
      }
      const timer =
        step.kind === 'answer'
          ? setTimeout(() => {
              resolve(step.respond());
            }, step.afterMs)
          : undefined;
      init?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('the request was aborted'));
        },
        { once: true },
      );
    });

  return { fetch, seen };
}

/** Headers available now and the body only after `delayMs`: the header bound
 *  is cleared when the response arrives, so only the call's own 30 seconds
 *  still cover the body. */
function bodyAfter(
  delayMs: number,
  body: string,
  contentType: string,
): Response {
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(bytes);
          controller.close();
        }, delayMs);
      },
    }),
    { headers: { 'content-type': contentType } },
  );
}

/** Every refusal is exactly `{ type, message }`: neither the body nor any
 *  response header rides along with a failure. */
function refusalOf(
  result: WebResponse | WebFetchFailure,
): WebResponse | WebFetchFailure {
  expect(Object.keys(result).sort()).toEqual(['message', 'type']);
  return result;
}

describe('web fetch client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one GET that identifies llame, negotiates Markdown, and carries no credential', async () => {
    let requested: RequestInfo | URL | undefined;
    let seen: RequestInit | undefined;
    const deps: TestDeps = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        requested = input;
        seen = init;
        return Promise.resolve(textResponse('# Title\n', 'text/markdown'));
      },
    };

    const result = await fetchOne(deps);

    const { signal, ...request } = seen ?? {};
    expect(requested).toBe(URL_);
    expect(request).toStrictEqual({
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        accept: 'text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5',
        'user-agent': USER_AGENT,
      },
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/markdown',
      body: '# Title\n',
    });
  });

  it('returns a JSON body as text with its declared type', async () => {
    const deps = serving(textResponse('{"ok":true}', 'application/json'));

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'application/json',
      body: '{"ok":true}',
    });
  });

  it('accepts a +json subtype', async () => {
    const deps = serving(textResponse('{"@id":"x"}', 'application/ld+json'));

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'application/ld+json',
      body: '{"@id":"x"}',
    });
  });

  it.each([
    // No parameters: the whole header is the media type.
    { header: 'TEXT/MARKDOWN', contentType: 'text/markdown' },
    // Parameters: the space before them belongs to the media type, and
    // trimming it away is what keeps this JSON body readable at all.
    {
      header: 'application/json ; charset=UTF-8',
      contentType: 'application/json; charset=UTF-8',
    },
  ])(
    'folds the media type of $header but keeps the parameters as received',
    async ({ header, contentType }) => {
      const deps = serving(textResponse('# Title\n', header));

      const result = await fetchOne(deps);

      expect(result).toStrictEqual({
        finalUrl: URL_,
        contentType,
        body: '# Title\n',
      });
    },
  );

  it('folds away a non-HTTP space around the media type', async () => {
    // `Headers` normalizes HTTP whitespace only, so a no-break space — U+00A0,
    // which a server can send — arrives with the value: the client names the
    // body's media type instead of refusing a body it can read.
    const deps = serving(textResponse('# Title\n', '\u00a0TEXT/MARKDOWN'));

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/markdown',
      body: '# Title\n',
    });
  });

  it('refuses a binary body with its type named', async () => {
    const cancelled = vi.fn();
    const deps = serving(
      streamingResponse(
        [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
        { headers: { 'content-type': 'application/pdf' } },
        cancelled,
      ),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'unsupported_content_type');
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining('application/pdf'),
    );
    expect(cancelled).toHaveBeenCalled();
  });

  it('bounds and strips the media type it echoes', async () => {
    // A hostile type is kilobytes long with control characters in it: the
    // refusal names a bounded, control-free form of it.
    const controls = '\u0007\u001b'.repeat(64);
    const mediaType = `application${controls}/${'x'.repeat(4096)}`;
    const deps = serving(
      new Response('binary', { headers: { 'content-type': mediaType } }),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'unsupported_content_type');
    expect(result).toHaveProperty(
      'message',
      expect.stringMatching(
        /^Unsupported content type "application\/x{52}"\.$/u,
      ),
    );
  });

  it('refuses a response that declares no content type', async () => {
    const deps = serving(new Response(null));

    const result = refusalOf(await fetchOne(deps));

    expect(result).toStrictEqual({
      type: 'unsupported_content_type',
      message: 'The response declares no content type.',
    });
  });

  it.each([404, 500])('fails HTTP %i without its body', async (status) => {
    const deps = serving(new Response('error page', { status }));

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'http_status');
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining(`HTTP ${status}`),
    );
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a 429 with the server’s retry delay and retries nothing', async () => {
    const deps = serving(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '120' },
      }),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'http_status');
    expect(result).toHaveProperty(
      'message',
      expect.stringMatching(/429.*120/u),
    );
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds and strips the Retry-After it echoes', async () => {
    // The header is kilobytes long and carries C0 and C1 controls: the server
    // wrote it, so the failure bounds it and drops the controls instead of
    // echoing either through to the model.
    const controls = '\u0007\u001b\u0085'.repeat(64);
    const retryAfter = `120${controls}${'A'.repeat(4096)}`;
    const deps = serving(
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': retryAfter },
      }),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'http_status');
    // 64 characters: the controls are stripped before the cut, so the bound
    // counts the characters the model reads.
    expect(result).toHaveProperty(
      'message',
      expect.stringMatching(
        /^The server answered HTTP 429; retry after 120A{61}\.$/u,
      ),
    );
  });

  it('refuses a 3xx status the redirect requirement does not govern', async () => {
    // 304 is not one of the five followed statuses, so a `Location` on it is
    // not a hop: the call fails with the status it received.
    const deps = serving(redirectResponse(304, URL_));

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'http_status');
    expect(result).toHaveProperty('message', 'The server answered HTTP 304.');
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails a declared length over the cap before the body is read', async () => {
    const cancelled = vi.fn();
    // The body itself never ends, so a read of it could only hang: returning
    // at all proves the declared length short-circuited the read.
    const deps = serving(
      streamingResponse(
        [],
        {
          headers: {
            'content-type': 'text/plain',
            'content-length': String(CAP_BYTES + 1),
          },
        },
        cancelled,
      ),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'body_too_large');
    expect(result).toHaveProperty('message', expect.stringContaining('5 MiB'));
    expect(cancelled).toHaveBeenCalled();
  });

  it('aborts a streamed body past the cap', async () => {
    const cancelled = vi.fn();
    const deps = serving(
      streamingResponse(
        [new Uint8Array(CAP_BYTES), new Uint8Array(1)],
        { headers: { 'content-type': 'text/plain' } },
        cancelled,
      ),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'body_too_large');
    expect(result).toHaveProperty('message', expect.any(String));
    expect(cancelled).toHaveBeenCalled();
  });

  it('accepts a body whose declared length is exactly the cap', async () => {
    // The over-cap side is pinned by the tests around this one, but a cap
    // shrunk below 5 MiB, or a declared length read as being past it, would
    // keep every one of them green: this holds the inside of both boundaries.
    const deps = serving(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(CAP_BYTES).fill(0x61));
            controller.close();
          },
        }),
        {
          headers: {
            'content-type': 'text/plain',
            'content-length': String(CAP_BYTES),
          },
        },
      ),
    );

    const result = await fetchOne(deps);

    expect(result).toHaveProperty('body', 'a'.repeat(CAP_BYTES));
  });

  it('reports a body that fails mid-stream as a transport failure', async () => {
    const deps = serving(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error('socket hang up'));
          },
        }),
        { headers: { 'content-type': 'text/plain' } },
      ),
    );

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'network_error');
    expect(result).toHaveProperty('message', 'socket hang up');
  });

  it('fails a body read the call deadline interrupts', async () => {
    const deps: TestDeps = {
      fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              // The transport tears a pending read down when the request's
              // signal aborts, which is how undici ends a streamed body.
              pull: () =>
                new Promise<void>((_resolve, reject) => {
                  init?.signal?.addEventListener(
                    'abort',
                    () => reject(new Error('the request was aborted')),
                    { once: true },
                  );
                }),
            }),
            { headers: { 'content-type': 'text/plain' } },
          ),
        ),
    };

    const result = refusalOf(await fetchOne(deps, { deadlineMs: 20 }));

    expect(result).toHaveProperty('type', 'call_timeout');
    expect(result).toHaveProperty(
      'message',
      'The web read exceeded its 30-second budget.',
    );
  });

  it('decodes a body with the charset its content type declares', async () => {
    const deps = serving(
      new Response(Buffer.from('café', 'latin1'), {
        headers: { 'content-type': 'text/plain; charset=iso-8859-1' },
      }),
    );

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/plain; charset=iso-8859-1',
      body: 'café',
    });
  });

  it('decodes a body with its <meta charset> declaration', async () => {
    // 11 bytes of markup and a 2,000-byte comment put the 27-byte declaration
    // at bytes 2011-2037: inside the scan window, ten bytes from its end.
    const html = metaCharsetHtml(1993);
    const deps = serving(
      new Response(Buffer.from(html, 'latin1'), {
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/html',
      body: html,
    });
  });

  it('ignores a <meta charset> past the 2 KiB scan window', async () => {
    // The same declaration pushed past the window is never scanned, so the
    // body falls back to UTF-8 and the Latin-1 é arrives as the replacement
    // character.
    const html = metaCharsetHtml(2043);
    const deps = serving(
      new Response(Buffer.from(html, 'latin1'), {
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/html',
      body: html.replace('é', '\uFFFD'),
    });
  });

  it('falls back to UTF-8 for a charset label it does not know', async () => {
    const deps = serving(
      new Response(Buffer.from('café', 'utf8'), {
        headers: { 'content-type': 'text/plain; charset=nonsense-1' },
      }),
    );

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/plain; charset=nonsense-1',
      body: 'café',
    });
  });

  it('reports a rejected transport with the cause’s message only', async () => {
    const deps: TestDeps = {
      fetch: () =>
        Promise.reject(new Error('getaddrinfo ENOTFOUND docs.example.test')),
    };

    const result = refusalOf(await fetchOne(deps));

    expect(result).toHaveProperty('type', 'network_error');
    expect(result).toHaveProperty(
      'message',
      'getaddrinfo ENOTFOUND docs.example.test',
    );
  });

  it('reports a rejected transport whose message names the request URL without it', async () => {
    // Node's own error when the request URL carries credentials, verbatim:
    // neither the locator nor the credential it carried may reach the model.
    const locator = 'https://user:secret@evil.test/x';
    const deps: TestDeps = {
      fetch: () =>
        Promise.reject(
          new TypeError(
            `Request cannot be constructed from a URL that includes credentials: ${locator}`,
          ),
        ),
    };

    const result = refusalOf(await fetchOne(deps, {}, locator));

    expect(result).toStrictEqual({
      type: 'network_error',
      message: 'The request failed.',
    });
    expect(JSON.stringify(result)).not.toContain('evil.test');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports a rejected transport whose message names another URL without it', async () => {
    const deps: TestDeps = {
      fetch: () =>
        Promise.reject(new Error('fetch failed: https://evil.test/x')),
    };

    const result = refusalOf(await fetchOne(deps));

    expect(result).toStrictEqual({
      type: 'network_error',
      message: 'The request failed.',
    });
    expect(JSON.stringify(result)).not.toContain('evil.test');
  });

  it('strips and bounds a transport message before echoing it', async () => {
    // A transport is free to hand over kilobytes of control characters, so the
    // echo is stripped and bounded like every other server-controlled one.
    const deps: TestDeps = {
      fetch: () => Promise.reject(new Error(`\u0000${'a'.repeat(4096)}\u0007`)),
    };

    const result = refusalOf(await fetchOne(deps));

    expect(result).toStrictEqual({
      type: 'network_error',
      message: 'a'.repeat(64),
    });
  });

  it('surfaces an ordinary transport message unchanged', async () => {
    const deps: TestDeps = {
      fetch: () => Promise.reject(new Error('fetch failed')),
    };

    const result = refusalOf(await fetchOne(deps));

    expect(result).toStrictEqual({
      type: 'network_error',
      message: 'fetch failed',
    });
  });

  it('reports a caller abort as aborted', async () => {
    const controller = new AbortController();
    const pending = fetchOne(
      { fetch: silentFetch },
      { signal: controller.signal },
    );

    controller.abort();

    const result = refusalOf(await pending);

    expect(result).toHaveProperty('type', 'aborted');
    expect(result).toHaveProperty('message', 'The web read was cancelled.');
  });

  it('issues no request when the caller has already aborted', async () => {
    const deps = serving(new Response(null));

    const result = refusalOf(
      await fetchOne(deps, { signal: AbortSignal.abort() }),
    );

    expect(result).toHaveProperty('type', 'aborted');
    expect(result).toHaveProperty('message', 'The web read was cancelled.');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('fails at the 10-second header bound when no headers arrive', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const pending = fetchOne({ fetch: silentFetch });
    void pending.then(settled);

    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = refusalOf(await pending);

    expect(result).toHaveProperty('type', 'headers_timeout');
    expect(result).toHaveProperty(
      'message',
      'The server sent no response headers within 10 seconds.',
    );
  });

  it('never lets a caller extend the 30-second call bound', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const cancelled = vi.fn();
    const deps = serving(
      streamingResponse(
        [],
        { headers: { 'content-type': 'text/plain' } },
        cancelled,
      ),
    );
    const pending = fetchOne(deps, { deadlineMs: 600_000 });
    void pending.then(settled);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = refusalOf(await pending);

    expect(result).toHaveProperty('type', 'call_timeout');
    expect(result).toHaveProperty(
      'message',
      'The web read exceeded its 30-second budget.',
    );
    expect(cancelled).toHaveBeenCalled();
  });

  it('fails a body that outlasts the call deadline', async () => {
    const cancelled = vi.fn();
    const deps = serving(
      streamingResponse(
        [],
        { headers: { 'content-type': 'text/plain' } },
        cancelled,
      ),
    );

    const result = refusalOf(await fetchOne(deps, { deadlineMs: 20 }));

    expect(result).toHaveProperty('type', 'call_timeout');
    expect(result).toHaveProperty(
      'message',
      'The web read exceeded its 30-second budget.',
    );
    expect(cancelled).toHaveBeenCalled();
  });

  it('reassembles a body that arrives in several chunks', async () => {
    const parts = ['web ', 'read ', 'client'];
    const deps = serving(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) controller.enqueue(Buffer.from(part));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/plain' } },
      ),
    );

    const result = await fetchOne(deps);

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/plain',
      body: 'web read client',
    });
  });

  it('ignores a declared length that is not a run of digits', async () => {
    // `1e10` is past the cap read as a number, but an HTTP `Content-Length` is
    // digits only: a hint this client must not act on.
    const deps = serving(
      new Response('ok', {
        headers: { 'content-type': 'text/plain', 'content-length': '1e10' },
      }),
    );

    const result = await fetchOne(deps);

    expect(result).toHaveProperty('body', 'ok');
  });

  it.each([
    {
      status: 500,
      retryAfter: '120',
      message: 'The server answered HTTP 500.',
    },
    { status: 429, retryAfter: '', message: 'The server answered HTTP 429.' },
  ])(
    'echoes no retry delay the HTTP $status answer does not carry',
    async ({ status, retryAfter, message }) => {
      const deps = serving(
        new Response('no', {
          status,
          headers: { 'retry-after': retryAfter },
        }),
      );

      const result = refusalOf(await fetchOne(deps));

      expect(result).toStrictEqual({ type: 'http_status', message });
    },
  );

  it('reports a transport failure that is not an Error without its message', async () => {
    // An Error-shaped reason that is not an `Error` to `instanceof`, which is
    // what a transport handing over a plain rejection value produces: the
    // client falls back to its own message instead of echoing one it cannot
    // trust.
    const cause = new Error('socket hang up');
    Object.setPrototypeOf(cause, Object.prototype);
    const deps: TestDeps = { fetch: () => Promise.reject(cause) };

    const result = refusalOf(await fetchOne(deps));

    expect(result).toStrictEqual({
      type: 'network_error',
      message: 'The request failed.',
    });
  });

  it('takes its abort listeners off both signals when the read is over', async () => {
    const caller = new AbortController();
    let request: AbortSignal | undefined;
    let boundWhileCalling = -1;
    const deps: TestDeps = {
      fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
        request = signalOf(init);
        boundWhileCalling = abortListeners(caller.signal);
        return Promise.resolve(textResponse('done', 'text/plain'));
      },
    };

    const result = await fetchOne(deps, { signal: caller.signal });

    expect(result).toHaveProperty('body', 'done');
    // The caller's signal carries the client's listener for the whole call,
    // and neither signal carries one once the call is over. The request
    // signal's own listener, held over the same stretch, is pinned by the
    // cancel test below.
    expect(boundWhileCalling).toBe(1);
    expect(abortListeners(caller.signal)).toBe(0);
    expect(abortListeners(request)).toBe(0);
  });

  it('stops listening to the caller’s signal the moment it aborts', async () => {
    const caller = new AbortController();
    let answer: (() => void) | undefined;
    const deps: TestDeps = {
      fetch: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(textResponse('late', 'text/plain'));
        }),
    };

    const pending = fetchOne(deps, { signal: caller.signal });
    caller.abort();
    // The call is still waiting on the transport here, so a listener the abort
    // had already consumed would still be attached: the registration is a one
    // shot, not a standing one.
    const stillBound = abortListeners(caller.signal);

    answer?.();
    const result = refusalOf(await pending);

    expect(stillBound).toBe(0);
    expect(result).toHaveProperty('type', 'aborted');
  });

  it('unbinds from the request’s signal before its abort handling runs', async () => {
    let request: AbortSignal | undefined;
    const stillBound: Array<number> = [];
    const deps: TestDeps = {
      fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
        request = signalOf(init);
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              // No chunk ever arrives: only the client's own cancel ends this.
              pull: () => new Promise<void>(() => undefined),
              cancel: () => {
                stillBound.push(abortListeners(request));
              },
            }),
            { headers: { 'content-type': 'text/plain' } },
          ),
        );
      },
    };

    const result = refusalOf(await fetchOne(deps, { deadlineMs: 20 }));

    expect(result).toHaveProperty('type', 'call_timeout');
    // The request signal carried the listener when the read began, and the
    // client had already taken it off as its own cancel ran.
    expect(stillBound).toEqual([0]);
  });

  it('cancels a body the call aborted before the reader was attached', async () => {
    const caller = new AbortController();
    const cancelled = vi.fn();
    const deps: TestDeps = {
      fetch: () => {
        // The caller gives up in the instant between the headers and the body,
        // so the request signal has already fired by the time the reader is
        // attached and its listener will never run.
        caller.abort();
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull: () =>
                Promise.reject(new Error('the transport tore the body down')),
              cancel: cancelled,
            }),
            { headers: { 'content-type': 'text/plain' } },
          ),
        );
      },
    };

    const result = refusalOf(await fetchOne(deps, { signal: caller.signal }));

    expect(result).toHaveProperty('type', 'aborted');
    expect(cancelled).toHaveBeenCalled();
  });
});

describe('web fetch redirects', () => {
  const START = 'https://a.example.test/start';
  const TARGET = 'https://b.example.test/guide';

  // The per-request header-bound case drives the clock itself, so a failure
  // inside it must not leave fake timers behind for the rest of the block.
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([301, 302, 303, 307, 308])(
    'follows HTTP %i to the locator it names',
    async (status) => {
      const admitted: Array<[string, string]> = [];
      const deps = routing(
        (url) =>
          url === START
            ? redirectResponse(status, TARGET)
            : textResponse('# Guide\n', 'text/markdown'),
        (kind, url) => {
          admitted.push([kind, url]);
          return ALLOW;
        },
      );

      const result = await fetchOne(deps, {}, START);

      expect(result).toStrictEqual({
        finalUrl: TARGET,
        contentType: 'text/markdown',
        body: '# Guide\n',
      });
      expect(deps.seen).toEqual([START, TARGET]);
      // The hop is admitted before its request, as the submitted locator was.
      expect(admitted).toEqual([['hop', TARGET]]);
    },
  );

  it('follows a cross-host hop and reports where the content came from', async () => {
    const deps = routing(
      (url) =>
        url === START
          ? new Response('moved', {
              status: 302,
              headers: {
                location: TARGET,
                link: '<https://a.example.test/other.md>; rel="alternate"',
              },
            })
          : new Response('# Guide\n', {
              headers: {
                'content-type': 'text/markdown',
                link: '<https://b.example.test/guide.md>; rel="alternate"',
              },
            }),
      () => ALLOW,
    );

    const result = await fetchOne(deps, {}, START);

    // The final response's own `Link` header, never one the call followed away
    // from, and no hop chain in the result.
    expect(result).toStrictEqual({
      finalUrl: TARGET,
      contentType: 'text/markdown',
      body: '# Guide\n',
      link: '<https://b.example.test/guide.md>; rel="alternate"',
    });
  });

  it('resolves a relative Location against the redirecting request’s URL', async () => {
    const base = 'https://docs.example.test/a/b/start';
    const resolved = 'https://docs.example.test/a/Guide';
    const admitted: Array<[string, string]> = [];
    const deps = routing(
      (url) =>
        url === base
          ? redirectResponse(302, '../Guide')
          : textResponse('guide', 'text/markdown'),
      (kind, url) => {
        admitted.push([kind, url]);
        return ALLOW;
      },
    );

    const result = await fetchOne(deps, {}, base);

    expect(admitted).toEqual([['hop', resolved]]);
    expect(deps.seen).toEqual([base, resolved]);
    expect(result).toHaveProperty('finalUrl', resolved);
  });

  it('normalizes a hop with the WHATWG parser before policy sees it', async () => {
    const admitted: Array<[string, string]> = [];
    const deps = routing(
      (url) =>
        url === START
          ? redirectResponse(302, 'HTTPS://B.EXAMPLE.TEST:443/Guide')
          : textResponse('guide', 'text/markdown'),
      (kind, url) => {
        admitted.push([kind, url]);
        return ALLOW;
      },
    );

    await fetchOne(deps, {}, START);

    // Lowercase host, default port dropped: policy matches the text the next
    // request uses, not the spelling the server chose.
    expect(admitted).toEqual([['hop', 'https://b.example.test/Guide']]);
  });

  it.each<[string, string | undefined]>([
    ['a redirect with no Location at all', undefined],
    ['a Location that is not parsable', 'https://[not-a-host/'],
    ['a Location carrying userinfo', 'https://user:secret@b.example.test/x'],
    ['a Location naming a non-web scheme', 'mailto:ops@example.test'],
  ])(
    'fails %s as invalid_redirect before any request to the target',
    async (_case, location) => {
      const deps = routing(() => redirectResponse(302, location));

      const result = await fetchOne(deps, {}, START);

      expect(result).toStrictEqual({
        type: 'invalid_redirect',
        message: 'The server answered with a redirect this tool cannot follow.',
      });
      // One request: the target is never contacted, and neither its name nor
      // the credential it carried reaches the model.
      expect(deps.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('b.example.test');
      expect(JSON.stringify(result)).not.toContain('secret');
    },
  );

  it('drops a hop’s fragment before admission and before the request', async () => {
    // The allow is anchored on the exact path, so it only admits the locator
    // the request will use: a fragment left in the text would have failed it.
    const compiled = compileToolPermissionMap(
      {
        read: {
          allow: [
            {
              field: 'path',
              regex: String.raw`^https://a\.example\.test/guide$`,
            },
          ],
        },
      },
      'test-policy',
    );
    const stripped = 'https://a.example.test/guide';
    const deps = routing(
      (url) =>
        url === START
          ? redirectResponse(302, '/guide#section')
          : textResponse('guide', 'text/markdown'),
      createDerivedAdmission({
        userId: 'owner',
        chatId: 'chat',
        permissionPolicy: compiled,
        tenantDb: {
          runAs: () => Promise.reject(new Error('no database in this test')),
        },
      }),
    );

    const result = await fetchOne(deps, {}, START);

    expect(deps.seen).toEqual([START, stripped]);
    expect(result).toHaveProperty('finalUrl', stripped);
  });

  it('never reads the body of the redirect it follows', async () => {
    const cancelled = vi.fn();
    const deps = routing(
      (url) =>
        url === START
          ? streamingResponse(
              [],
              { status: 302, headers: { location: TARGET } },
              cancelled,
            )
          : textResponse('guide', 'text/markdown'),
      () => ALLOW,
    );

    const result = await fetchOne(deps, {}, START);

    expect(result).toHaveProperty('finalUrl', TARGET);
    expect(cancelled).toHaveBeenCalled();
  });

  it('fails the call when the redirect budget is exhausted', async () => {
    const deps = routing(
      () => redirectResponse(302, '/next'),
      () => ALLOW,
    );

    const result = await fetchOne(deps, {}, START);

    expect(result).toStrictEqual({
      type: 'too_many_redirects',
      message:
        'The server redirected more than the 20 hops one call may follow.',
    });
    // The first request and the 20 hops it followed; the 21st redirect is
    // refused without a request of its own.
    expect(deps.fetch).toHaveBeenCalledTimes(21);
  });

  it('shares one redirect budget across the locators of a call', async () => {
    const deps = routing(
      () => redirectResponse(302, '/next'),
      () => ALLOW,
    );
    const session = createWebFetchSession(
      { userAgent: USER_AGENT },
      { fetch: deps.fetch, admit: deps.admit },
    );
    try {
      // The first locator spends the whole 20-hop budget.
      const first = await session.fetch(START);
      // The second locator's first redirect finds the budget gone: it is the
      // call's, not one locator's, which is what the pipeline's probes share.
      const second = await session.fetch(`${START}/other`);

      expect(first).toHaveProperty('type', 'too_many_redirects');
      expect(second).toHaveProperty('type', 'too_many_redirects');
      expect(deps.fetch).toHaveBeenCalledTimes(22);
    } finally {
      session.dispose();
    }
  });

  it('ends the call at a refused hop without requesting the target', async () => {
    const refused = 'https://evil.example.test/steal?token=secret#part';
    const admitted: Array<[string, string]> = [];
    const deps = routing(
      () => redirectResponse(302, refused),
      (kind, url) => {
        admitted.push([kind, url]);
        return REFUSE;
      },
    );

    const result = await fetchOne(deps, {}, START);

    expect(result).toStrictEqual({
      type: 'permission_denied',
      message: REJECTED_HOP_MESSAGE,
      // Origin and path only: the query and the fragment the server chose
      // never reach the model.
      rejectedUrl: 'https://evil.example.test/steal',
    });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    // The decision is reported for the locator policy refused, exactly as the
    // model would have had it evaluate its own text — with the fragment the
    // request drops already gone.
    expect(admitted).toEqual([
      ['hop', 'https://evil.example.test/steal?token=secret'],
    ]);
  });

  it('reports the same fixed message for every refused hop', async () => {
    const refuse = () => REFUSE;
    const first = await fetchOne(
      routing(
        () => redirectResponse(302, 'https://evil.example.test/a?token=1'),
        refuse,
      ),
      {},
      START,
    );
    const second = await fetchOne(
      routing(
        () => redirectResponse(302, 'http://evil.example.test/b'),
        refuse,
      ),
      {},
      START,
    );

    expect(first).toHaveProperty('message', REJECTED_HOP_MESSAGE);
    expect(second).toHaveProperty('message', REJECTED_HOP_MESSAGE);
    expect(first).toHaveProperty('rejectedUrl', 'https://evil.example.test/a');
    expect(second).toHaveProperty('rejectedUrl', 'http://evil.example.test/b');
  });

  it('bounds the locator a refused hop reports', async () => {
    const path = `/${'a'.repeat(3000)}`;
    const deps = routing(
      () => redirectResponse(302, `https://evil.example.test${path}?token=1`),
      () => REFUSE,
    );

    const result = await fetchOne(deps, {}, START);

    expect(result).toHaveProperty(
      'rejectedUrl',
      `https://evil.example.test${path}`.slice(0, 2048),
    );
  });

  it('sends no cookie or credential on any hop, with the first request’s headers', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const deps: TestDeps = {
      admit: () => ALLOW,
      fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init);
        return Promise.resolve(
          seen.length === 1
            ? redirectResponse(302, TARGET)
            : textResponse('guide', 'text/markdown'),
        );
      },
    };

    await fetchOne(deps, {}, START);

    expect(seen).toHaveLength(2);
    for (const init of seen) {
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect([...headers.keys()].sort()).toEqual(['accept', 'user-agent']);
      expect(headers.get('user-agent')).toBe(USER_AGENT);
    }
  });

  it('bounds every request of a redirect chain on its own header wait', async () => {
    // The clock is fake throughout, so the two 9-second waits and the slow
    // body are driven deterministically: the only timers that run are the
    // client's own bound and the scripted transport's.
    vi.useFakeTimers();
    const chainSettled = vi.fn();
    const deps = delayedRouting([
      // 9 s to the first response, then 9 s to the second: each wait is
      // inside the 10-second bound its own request arms, and together they
      // are past one.
      {
        kind: 'answer',
        afterMs: 9000,
        respond: () => redirectResponse(302, TARGET),
      },
      {
        kind: 'answer',
        afterMs: 9000,
        respond: () => bodyAfter(7000, '# Guide\n', 'text/markdown'),
      },
    ]);
    const chain = fetchOne(
      { fetch: deps.fetch, admit: () => ALLOW },
      {},
      START,
    );
    void chain.then(chainSettled);

    await vi.advanceTimersByTimeAsync(9000);
    expect(deps.seen).toEqual([START, TARGET]);
    expect(chainSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(9999);
    // A bound armed once for the chain, or one the first response left armed,
    // would have aborted the call as `headers_timeout` at the 10-second mark.
    expect(chainSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    // The second response cleared its own bound on arrival: a bound re-armed
    // but never cleared would fire here, 10 s after the hop was sent.
    expect(chainSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(6000);
    expect(await chain).toStrictEqual({
      finalUrl: TARGET,
      contentType: 'text/markdown',
      body: '# Guide\n',
    });

    // A hop that never answers is bounded by its own 10 seconds, not by the
    // call's 30: a bound the first request armed and the hop never re-armed
    // would leave this wait to the call bound.
    const hopSettled = vi.fn();
    const stalled = delayedRouting([
      {
        kind: 'answer',
        afterMs: 9000,
        respond: () => redirectResponse(302, TARGET),
      },
      { kind: 'silent' },
    ]);
    const refused = fetchOne(
      { fetch: stalled.fetch, admit: () => ALLOW },
      {},
      START,
    );
    void refused.then(hopSettled);

    await vi.advanceTimersByTimeAsync(9000);
    expect(stalled.seen).toEqual([START, TARGET]);
    await vi.advanceTimersByTimeAsync(9999);
    expect(hopSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(hopSettled).toHaveBeenCalled();
    expect(refusalOf(await refused)).toHaveProperty('type', 'headers_timeout');
  });
});
