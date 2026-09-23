import { createServer, type Server, type ServerResponse } from 'node:http';
import { Response } from 'undici';
import { type Mock, vi } from 'vitest';

import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolContext } from './types';
import {
  createWebReadExecutor,
  realWebReadDeps,
  type WebReadDeps,
  type WebReadExecutor,
} from './web-read/execute';
import type { ResolveHost } from './web-read/http-client';
import { createWebFetchSession } from './web-read/http-client';
import { renderWebContent } from './web-read/pipeline';

const READ_POLICY = compileToolPermissionMap(
  { read: { allow: true } },
  'test-policy',
);
const TEST_ADDRESS = [{ address: '93.184.216.34', family: 4 }] as const;
const resolvePublicAddress: ResolveHost = () => Promise.resolve(TEST_ADDRESS);

type TestFetch = NonNullable<WebReadDeps['fetch']>;

function webReadExecutor(
  overrides: Partial<WebReadDeps> = {},
): WebReadExecutor {
  return createWebReadExecutor({
    ...realWebReadDeps,
    fetch: fetchDouble,
    resolve: resolvePublicAddress,
    ...overrides,
  });
}

let fetchDouble: Mock<TestFetch>;

const MARKDOWN = '# Guide\n\nA publisher-provided body for agents.\n';

/** A markup body whose lines are told apart by name, so a read that converts
 *  and numbers it cannot be confused with one that returns it verbatim. */
const PAGE_LINES = [
  '<html>',
  '<body>',
  '<article>',
  '<h1>Guide</h1>',
  '<p>A paragraph of enough words to pass the conversion gate.</p>',
  '<p>A second paragraph of enough words to pass the gate.</p>',
  '<p>A third paragraph of enough words to pass the gate.</p>',
  '</article>',
  '</body>',
  '</html>',
];
const PAGE_HTML = `${PAGE_LINES.join('\n')}\n`;

type FixtureRequest = { readonly method: string; readonly path: string };
type FixtureResponse = {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
};
type WebFixture = {
  readonly port: number;
  readonly requests: Array<FixtureRequest>;
  respondWith(body: string, contentType: string, status?: number): void;
  close(): Promise<void>;
};

const DEFAULT_FIXTURE_RESPONSE: FixtureResponse = {
  status: 200,
  contentType: 'text/markdown; charset=utf-8',
  body: MARKDOWN,
};

function sendFixtureResponse(
  response: ServerResponse,
  fixtureResponse: FixtureResponse,
): void {
  response.writeHead(fixtureResponse.status, {
    'content-type': fixtureResponse.contentType,
  });
  response.end(fixtureResponse.body);
}

function closeFixtureServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

function startFixture(): Promise<WebFixture> {
  return new Promise<WebFixture>((resolve, reject) => {
    const requests: Array<FixtureRequest> = [];
    let nextResponse: FixtureResponse | undefined;
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? 'GET',
        path: request.url ?? '/',
      });
      const fixtureResponse = nextResponse ?? DEFAULT_FIXTURE_RESPONSE;
      nextResponse = undefined;
      sendFixtureResponse(response, fixtureResponse);
    });
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || !(address instanceof Object)) {
        reject(new Error('The web fixture did not receive a TCP address.'));
        return;
      }
      resolve({
        port: address.port,
        requests,
        respondWith(body, contentType, status = 200) {
          nextResponse = { status, contentType, body };
        },
        close: () => closeFixtureServer(server),
      });
    });
  });
}

function fixtureUrl(path: string): string {
  return `http://127.0.0.1:${fixture.port}${path}`;
}

/** The sentence the large body repeats. Rendering ~1 MiB of markup is the work
 *  a cancelled call must not start, and the sentence would reach the result if
 *  it did. */
const PARAGRAPH_TEXT = 'A guide paragraph for agents.';
const LARGE_HTML = `<html><body><article>${`<p>${PARAGRAPH_TEXT}</p>`.repeat(40_000)}</article></body></html>`;

/** A context with no Run identity at all: a web read needs none. */
function webContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    productUserAgent: 'llame/0.0.0-test',
    permissionPolicy: READ_POLICY,
    tenantDb: {
      runAs: () => Promise.reject(new Error('Database unavailable')),
    },
    ...overrides,
  };
}

let fixture: WebFixture;

describe('web locator dispatch', () => {
  beforeAll(async () => {
    fixture = await startFixture();
  });

  afterAll(() => fixture.close());

  beforeEach(() => {
    fetchDouble = vi.fn<TestFetch>(() =>
      Promise.resolve(
        new Response(MARKDOWN, {
          status: 200,
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        }),
      ),
    );
    fixture.requests.length = 0;
    fixture.respondWith(MARKDOWN, 'text/markdown; charset=utf-8');
  });

  /** Set the real fixture response for the next native read. */
  const respondWith = (
    body: string,
    contentType: string,
    status = 200,
  ): void => {
    fixture.respondWith(body, contentType, status);
  };

  it('reads a web locator and returns the web result', async () => {
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), { path: url });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: url,
      method: 'negotiated',
    });
    expect(JSON.stringify(result)).toContain('publisher-provided body');
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('needs no executor identity and binds none', async () => {
    const runAs = vi.fn(() =>
      Promise.reject(new Error('Database unavailable')),
    );
    const url = fixtureUrl('/guide');

    const result = await nativeReadTool.execute(
      webContext({ tenantDb: { runAs } }),
      { path: url },
    );

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: url,
    });
    expect(runAs).not.toHaveBeenCalled();
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('rejects edit and write on a web locator before any request', async () => {
    const url = fixtureUrl('/guide');
    const edited = await nativeEditTool.execute(webContext(), {
      path: url,
      oldText: 'a',
      newText: 'b',
    });
    const written = await nativeWriteTool.execute(webContext(), {
      path: url,
      content: 'x',
    });

    for (const result of [edited, written]) {
      expect(result).toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
      expect(JSON.stringify(result)).toContain('read-only');
    }
    expect(fixture.requests).toEqual([]);
  });

  it('fails closed when the instance identity is missing', async () => {
    const result = await nativeReadTool.execute(
      webContext({ productUserAgent: undefined }),
      { path: fixtureUrl('/guide') },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(JSON.stringify(result)).toContain('User-Agent');
    expect(JSON.stringify(result)).not.toContain('/guide');
    expect(fixture.requests).toEqual([]);
  });

  it('still refuses an unknown non-web scheme', async () => {
    const result = await nativeReadTool.execute(webContext(), {
      path: 'ftp://example.test/guide',
    });

    expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
    // The two web schemes are not a catch-all: a scheme outside them keeps
    // the unknown-scheme refusal rather than the web locator's own.
    expect(result).toHaveProperty(
      'message',
      'This path scheme is not available.',
    );
    expect(fixture.requests).toEqual([]);
  });

  it('reads an http locator through the same branch as https', async () => {
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), { path: url });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: url,
      method: 'negotiated',
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('returns the body verbatim for a :raw read', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: fixtureUrl('/guide:raw'),
    });

    expect(result).toMatchObject({
      status: 'success',
      representation: 'raw',
      method: 'raw',
      content: PAGE_HTML,
      shownRange: { startLine: 1, endLine: PAGE_LINES.length },
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('returns an unnumbered window for a :raw line selector', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: fixtureUrl('/guide:raw:4-5'),
    });

    expect(result).toMatchObject({
      status: 'success',
      representation: 'raw',
      method: 'raw',
      content: `${PAGE_LINES[3]}\n${PAGE_LINES[4]}\n`,
      requestedRange: { startLine: 4, endLine: 5 },
      shownRange: { startLine: 4, endLine: 5 },
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('numbers the converted window for a selector that is not raw', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: fixtureUrl('/guide:4-5'),
    });

    // The window is the converted text, numbered: a read that skipped the
    // conversion would hand back the markup's own fourth and fifth lines.
    expect(result).toHaveProperty(
      'content',
      expect.stringMatching(/^3: A paragraph of enough words/u),
    );
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('<p>'),
    );
    expect(result).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'readability',
      requestedRange: { startLine: 4, endLine: 5 },
    });
    expect(fixture.requests[0]).toEqual({ method: 'GET', path: '/guide' });
  });

  it.each([
    ['HTTP', 'http'],
    ['HtTp', 'http'],
  ])(
    'dispatches the %s-scheme locator to the canonical %s URL',
    async (scheme, canonicalScheme) => {
      const path = `${scheme}://127.0.0.1:${fixture.port}/guide`;
      const canonical = `${canonicalScheme}://127.0.0.1:${fixture.port}/guide`;
      const result = await nativeReadTool.execute(webContext(), { path });

      expect(result).toMatchObject({ status: 'success', path: canonical });
      expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
    },
  );

  it.each(['https://127.0.0.1:1/guide', 'HTTPS://127.0.0.1:1/guide'])(
    'dispatches %s through the web executor',
    async (path) => {
      const result = await nativeReadTool.execute(webContext(), { path });

      expect(result).toMatchObject({
        status: 'error',
        type: 'network_error',
      });
    },
  );

  it('fetches a fragment locator without the fragment', async () => {
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), {
      path: `${url}#top`,
    });

    // The anchor never reaches the server, so it is cut before policy and
    // before the request: the page is read, and `finalUrl` names the
    // fragment-free locator that produced it.
    expect(result).toMatchObject({
      status: 'success',
      finalUrl: url,
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('still reads the lowercase spelling of the same locator', async () => {
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), { path: url });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: url,
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('runs through the collaborators the executor was bound with', async () => {
    const execute = webReadExecutor();

    const result = await execute(webContext(), {
      operation: 'read',
      input: { path: 'https://example.test/guide' },
    });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: 'https://example.test/guide',
      method: 'negotiated',
    });
    expect(fetchDouble.mock.calls[0]?.[0]).toBe('https://example.test/guide');
  });

  it('does not start the render when the fetch resolves after the Run aborted', async () => {
    const abort = new AbortController();
    const render = vi.fn(renderWebContent);
    // The client's deadline, and the listener that reports a caller abort, are
    // released when the session is disposed, so an abort that lands once the
    // fetch has resolved is visible only to the guard under test.
    const fetchThenAbort: typeof createWebFetchSession = (options, deps) => {
      const session = createWebFetchSession(options, deps);
      return {
        fetch: async (url) => {
          const response = await session.fetch(url);
          abort.abort();
          return response;
        },
        dispose: session.dispose,
      };
    };
    fetchDouble.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(LARGE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    const execute = webReadExecutor({
      createWebFetchSession: fetchThenAbort,
      renderWebContent: render,
    });

    const result = await execute(webContext({ abortSignal: abort.signal }), {
      operation: 'read',
      input: { path: 'https://example.test/guide' },
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'aborted',
      message: 'The web read was cancelled.',
    });
    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(PARAGRAPH_TEXT);
  });

  it('disposes the call session on both the rendered and the refused path', async () => {
    // The executor's `finally` is the only thing that releases the call timer
    // and the listener on the caller's signal, so the double wraps the real
    // session and counts its release on each path.
    const dispose = vi.fn();
    const sessionDouble: typeof createWebFetchSession = (options, deps) => {
      const session = createWebFetchSession(options, deps);
      return {
        fetch: session.fetch,
        dispose: () => {
          session.dispose();
          dispose();
        },
      };
    };
    const execute = webReadExecutor({
      createWebFetchSession: sessionDouble,
      renderWebContent,
    });

    const rendered = await execute(webContext(), {
      operation: 'read',
      input: { path: 'https://example.test/guide' },
    });

    expect(rendered).toMatchObject({
      status: 'success',
      method: 'negotiated',
    });
    expect(dispose).toHaveBeenCalledTimes(1);

    fetchDouble.mockImplementationOnce(() =>
      Promise.resolve(
        new Response('no such page', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      ),
    );
    const refused = await execute(webContext(), {
      operation: 'read',
      input: { path: 'https://example.test/guide' },
    });

    expect(refused).toMatchObject({ status: 'error', type: 'http_status' });
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
