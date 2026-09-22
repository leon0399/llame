import { getEventListeners } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWebDocument } from './http-client';
import type { WebFetchDeps, WebFetchFailure, WebResponse } from './http-client';

const URL_ = 'https://docs.example.test/guides/adapter-pipelines.html';
const USER_AGENT = 'llame/1.2.3';
const CAP_BYTES = 5 * 1024 * 1024;

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
  return { fetch } satisfies WebFetchDeps;
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
    const deps: WebFetchDeps = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        requested = input;
        seen = init;
        return Promise.resolve(textResponse('# Title\n', 'text/markdown'));
      },
    };

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'application/json',
      body: '{"ok":true}',
    });
  });

  it('accepts a +json subtype', async () => {
    const deps = serving(textResponse('{"@id":"x"}', 'application/ld+json'));

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

      const result = await fetchWebDocument(
        URL_,
        { userAgent: USER_AGENT },
        deps,
      );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

    expect(result).toStrictEqual({
      type: 'unsupported_content_type',
      message: 'The response declares no content type.',
    });
  });

  it.each([404, 500])('fails HTTP %i without its body', async (status) => {
    const deps = serving(new Response('error page', { status }));

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

  it.each([301, 302, 303, 307, 308])(
    'refuses HTTP %i instead of following it',
    async (status) => {
      const deps = serving(
        new Response('moved', {
          status,
          headers: { location: 'https://elsewhere.example.test/' },
        }),
      );

      const result = refusalOf(
        await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
      );

      expect(result).toHaveProperty('type', 'http_status');
      expect(result).toHaveProperty(
        'message',
        expect.stringMatching(new RegExp(`HTTP ${status} .*redirect`, 'iu')),
      );
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    },
  );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

    expect(result).toHaveProperty('type', 'network_error');
    expect(result).toHaveProperty('message', 'socket hang up');
  });

  it('fails a body read the call deadline interrupts', async () => {
    const deps: WebFetchDeps = {
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

    const result = refusalOf(
      await fetchWebDocument(
        URL_,
        { userAgent: USER_AGENT, deadlineMs: 20 },
        deps,
      ),
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/plain; charset=nonsense-1',
      body: 'café',
    });
  });

  it('reports a rejected transport with the cause’s message only', async () => {
    const deps: WebFetchDeps = {
      fetch: () =>
        Promise.reject(new Error('getaddrinfo ENOTFOUND docs.example.test')),
    };

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

    expect(result).toHaveProperty('type', 'network_error');
    expect(result).toHaveProperty(
      'message',
      'getaddrinfo ENOTFOUND docs.example.test',
    );
  });

  it('reports a caller abort as aborted', async () => {
    const controller = new AbortController();
    const pending = fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT, signal: controller.signal },
      { fetch: silentFetch },
    );

    controller.abort();

    const result = refusalOf(await pending);

    expect(result).toHaveProperty('type', 'aborted');
    expect(result).toHaveProperty('message', 'The web read was cancelled.');
  });

  it('issues no request when the caller has already aborted', async () => {
    const deps = serving(new Response(null));

    const result = refusalOf(
      await fetchWebDocument(
        URL_,
        { userAgent: USER_AGENT, signal: AbortSignal.abort() },
        deps,
      ),
    );

    expect(result).toHaveProperty('type', 'aborted');
    expect(result).toHaveProperty('message', 'The web read was cancelled.');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('fails at the 10-second header bound when no headers arrive', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const pending = fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      { fetch: silentFetch },
    );
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
    const pending = fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT, deadlineMs: 600_000 },
      deps,
    );
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

    const result = refusalOf(
      await fetchWebDocument(
        URL_,
        { userAgent: USER_AGENT, deadlineMs: 20 },
        deps,
      ),
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

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

      const result = refusalOf(
        await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
      );

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
    const deps: WebFetchDeps = { fetch: () => Promise.reject(cause) };

    const result = refusalOf(
      await fetchWebDocument(URL_, { userAgent: USER_AGENT }, deps),
    );

    expect(result).toStrictEqual({
      type: 'network_error',
      message: 'The request failed.',
    });
  });

  it('takes its abort listeners off both signals when the read is over', async () => {
    const caller = new AbortController();
    let request: AbortSignal | undefined;
    let boundWhileCalling = -1;
    const deps: WebFetchDeps = {
      fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
        request = signalOf(init);
        boundWhileCalling = abortListeners(caller.signal);
        return Promise.resolve(textResponse('done', 'text/plain'));
      },
    };

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT, signal: caller.signal },
      deps,
    );

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
    const deps: WebFetchDeps = {
      fetch: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(textResponse('late', 'text/plain'));
        }),
    };

    const pending = fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT, signal: caller.signal },
      deps,
    );
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
    const deps: WebFetchDeps = {
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

    const result = refusalOf(
      await fetchWebDocument(
        URL_,
        { userAgent: USER_AGENT, deadlineMs: 20 },
        deps,
      ),
    );

    expect(result).toHaveProperty('type', 'call_timeout');
    // The request signal carried the listener when the read began, and the
    // client had already taken it off as its own cancel ran.
    expect(stillBound).toEqual([0]);
  });

  it('cancels a body the call aborted before the reader was attached', async () => {
    const caller = new AbortController();
    const cancelled = vi.fn();
    const deps: WebFetchDeps = {
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

    const result = refusalOf(
      await fetchWebDocument(
        URL_,
        { userAgent: USER_AGENT, signal: caller.signal },
        deps,
      ),
    );

    expect(result).toHaveProperty('type', 'aborted');
    expect(cancelled).toHaveBeenCalled();
  });
});
