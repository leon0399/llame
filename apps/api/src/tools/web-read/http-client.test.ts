import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWebDocument } from './http-client';
import type { WebFetchDeps, WebFetchFailure, WebResponse } from './http-client';

const URL_ = 'https://docs.example.test/guides/adapter-pipelines.html';
const USER_AGENT = 'llame/1.2.3';
const CAP_BYTES = 5 * 1024 * 1024;

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

  it('lowercases the media type but keeps the parameters as received', async () => {
    const deps = serving(
      textResponse('# Title\n', 'Text/Markdown; charset=UTF-8'),
    );

    const result = await fetchWebDocument(
      URL_,
      { userAgent: USER_AGENT },
      deps,
    );

    expect(result).toStrictEqual({
      finalUrl: URL_,
      contentType: 'text/markdown; charset=UTF-8',
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

    expect(result).toHaveProperty('type', 'unsupported_content_type');
    expect(result).toHaveProperty('message', expect.any(String));
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

  it('accepts a body of exactly the cap', async () => {
    // The over-cap side is pinned by the tests around this one, but a cap
    // shrunk below 5 MiB would keep every one of them green: this holds the
    // inside of the boundary.
    const deps = serving(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(CAP_BYTES).fill(0x61));
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
    expect(result).toHaveProperty('message', expect.any(String));
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
    expect(result).toHaveProperty('message', expect.any(String));
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
    expect(result).toHaveProperty('message', expect.any(String));
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
    expect(result).toHaveProperty('message', expect.any(String));
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
    expect(result).toHaveProperty('message', expect.any(String));
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
    expect(result).toHaveProperty('message', expect.any(String));
    expect(cancelled).toHaveBeenCalled();
  });
});
