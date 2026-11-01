import { readFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { Response } from 'undici';
import { type Mock, vi } from 'vitest';

import type { RetainedMedia } from '../media/attempt-media';
import type { MediaService } from '../media/media.service';
import * as pdfPreparation from '../media/pdf-preparation';
import {
  createToolMediaStore,
  type ToolMediaStore,
} from '../media/tool-media-store';
import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { ToolResult, type ToolContext } from './types';
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
const REWRITE_ADAPTER = {
  id: 'reader',
  use: 'rewrite',
  hosts: ['example.test'],
  target: 'https://reader.example.test{path}',
} as const;
const SOURCE_ONLY_POLICY = compileToolPermissionMap(
  {
    read: {
      allow: [
        {
          field: 'path',
          regex: String.raw`^https://example\.test/guide$`,
        },
      ],
    },
  },
  'source-only-policy',
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
/** The same shape with a two-column table, so a range inside it can only
 *  report its columns through the header pair. */
const RANGED_TABLE_MARKDOWN =
  [
    '# Root',
    'Root body',
    '## Details',
    'Details intro',
    '| Name | Value |',
    '| --- | --- |',
    '| alpha | 1 |',
    '| beta | 2 |',
  ].join('\n') + '\n';

const RANGED_MARKDOWN =
  [
    '# Root',
    'Root body',
    '## Details',
    'Details intro',
    '',
    'Selected body',
    'Tail',
  ].join('\n') + '\n';

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

const DECODED_IMAGE = {
  status: 'success',
  kind: 'image',
  mediaType: 'image/png',
  width: 4,
  height: 3,
  display: { thumbnail: 'data:image/webp;base64,AAAA' },
} as const;

/** A media store that records each decode and decodes every body it is given. */
function imageStore() {
  const decoded: Array<{ byteSize: number; bytes: Buffer }> = [];
  const media = {
    readMedia: vi.fn<ToolMediaStore['readMedia']>(
      () =>
        async ({ byteSize, readBytes }) => {
          decoded.push({ byteSize, bytes: await readBytes() });
          return DECODED_IMAGE;
        },
    ),
    findMedia: () => Promise.resolve(undefined),
  } satisfies ToolMediaStore;
  return { media, decoded };
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
    expect(result).not.toHaveProperty('notes');
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
  it('outlines a negotiated Markdown response', async () => {
    const result = await nativeReadTool.execute(webContext(), {
      path: fixtureUrl('/guide:outline'),
    });

    expect(result).toMatchObject({
      status: 'success',
      representation: 'outline',
      method: 'negotiated',
      content: '1: # Guide\n3: A publisher-provided body for agents.\n',
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('outlines a readability-converted HTML response', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: fixtureUrl('/guide:outline'),
    });

    expect(result).toMatchObject({
      status: 'success',
      representation: 'outline',
      method: 'readability',
    });
    expect(result).toHaveProperty(
      'content',
      expect.stringContaining('1: ## Guide'),
    );
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('<p>'),
    );
    expect(fixture.requests).toEqual([
      { method: 'GET', path: '/guide' },
      { method: 'GET', path: '/guide.md' },
    ]);
  });

  it('rejects outline for a plain-text response', async () => {
    respondWith(MARKDOWN, 'text/plain; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: fixtureUrl('/guide:outline'),
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_selector',
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
      expect.stringMatching(/^1: ## Guide\n3: A paragraph of enough words/u),
    );
    expect(result).toHaveProperty(
      'content',
      expect.not.stringContaining('<p>'),
    );
    expect(result).toMatchObject({
      status: 'success',
      representation: 'text',
      method: 'readability',
      requestedRanges: [{ startLine: 4, endLine: 5 }],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 6 },
      ],
    });
    expect(result).not.toHaveProperty('requestedRange');
    expect(result).not.toHaveProperty('shownRange');
    expect(fixture.requests[0]).toEqual({ method: 'GET', path: '/guide' });
  });

  it('prepends ancestors for a negotiated Markdown ranged read', async () => {
    respondWith(RANGED_MARKDOWN, 'text/markdown; charset=utf-8');
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), {
      path: `${url}:6-6`,
    });

    expect(result).toEqual({
      status: 'success',
      kind: 'file',
      path: url,
      representation: 'text',
      content: '1: # Root\n3: ## Details\n5: \n6: Selected body\n7: Tail\n',
      requestedRanges: [{ startLine: 6, endLine: 6 }],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 3 },
        { startLine: 5, endLine: 7 },
      ],
      nextOffset: 6,
      truncated: false,
      lineCount: 7,
      finalUrl: url,
      method: 'negotiated',
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('prepends the table header pair for a negotiated Markdown ranged read', async () => {
    respondWith(RANGED_TABLE_MARKDOWN, 'text/markdown; charset=utf-8');
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), {
      path: `${url}:8-8`,
    });

    expect(result).toEqual({
      status: 'success',
      kind: 'file',
      path: url,
      representation: 'text',
      content:
        '1: # Root\n' +
        '3: ## Details\n' +
        '5: | Name | Value |\n' +
        '6: | --- | --- |\n' +
        '7: | alpha | 1 |\n' +
        '8: | beta | 2 |\n',
      requestedRanges: [{ startLine: 8, endLine: 8 }],
      shownRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 3 },
        { startLine: 5, endLine: 8 },
      ],
      truncated: false,
      lineCount: 8,
      finalUrl: url,
      method: 'negotiated',
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
  });

  it('does not add ancestors to a negotiated plain-text ranged read', async () => {
    respondWith(RANGED_MARKDOWN, 'text/plain; charset=utf-8');
    const url = fixtureUrl('/guide');
    const result = await nativeReadTool.execute(webContext(), {
      path: `${url}:6-6`,
    });

    expect(result).toEqual({
      status: 'success',
      kind: 'file',
      path: url,
      representation: 'text',
      content: '5: \n6: Selected body\n7: Tail\n',
      requestedRange: { startLine: 6, endLine: 6 },
      shownRange: { startLine: 5, endLine: 7 },
      nextOffset: 6,
      truncated: false,
      lineCount: 7,
      finalUrl: url,
      method: 'negotiated',
    });
    expect(fixture.requests).toEqual([{ method: 'GET', path: '/guide' }]);
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
  it('dispatches a claimed rewrite before fetching the source', async () => {
    const source = 'https://example.test/guide';
    const execute = webReadExecutor();

    const result = await execute(
      webContext({ webAdapters: [REWRITE_ADAPTER] }),
      { operation: 'read', input: { path: source } },
    );

    expect(result).toMatchObject({
      status: 'success',
      method: 'adapter',
      finalUrl: source,
      adapter: {
        id: 'reader',
        route: 'rewrite',
        origin: 'https://reader.example.test',
      },
    });
    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble.mock.calls[0]?.[0]).toBe(
      'https://reader.example.test/guide',
    );
  });

  it('falls through a refused adapter target before reading the source', async () => {
    const source = 'https://example.test/guide';
    const execute = webReadExecutor();

    const result = await execute(
      webContext({
        permissionPolicy: SOURCE_ONLY_POLICY,
        webAdapters: [REWRITE_ADAPTER],
      }),
      { operation: 'read', input: { path: source } },
    );

    expect(result).toMatchObject({
      status: 'success',
      method: 'negotiated',
      finalUrl: source,
      notes: ['web adapter "reader" fell through: permission'],
    });
    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble.mock.calls[0]?.[0]).toBe(source);
  });

  it('preserves notes returned by the injected renderer', async () => {
    const render = vi.fn(renderWebContent);
    render.mockResolvedValue({
      method: 'text',
      content: 'rendered body',
      notes: ['render note'],
    });
    const execute = webReadExecutor({ renderWebContent: render });

    const result = await execute(webContext(), {
      operation: 'read',
      input: { path: 'https://example.test/guide' },
    });

    expect(result).toMatchObject({
      status: 'success',
      notes: ['render note'],
    });
  });
  it('does not dispatch a claimed adapter for a raw read', async () => {
    const source = 'https://example.test/guide';
    const execute = webReadExecutor();

    const result = await execute(
      webContext({ webAdapters: [REWRITE_ADAPTER] }),
      { operation: 'read', input: { path: `${source}:raw` } },
    );

    expect(result).toMatchObject({
      status: 'success',
      method: 'raw',
      finalUrl: source,
    });
    expect(result).not.toHaveProperty('adapter');
    expect(result).not.toHaveProperty('notes');
    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble.mock.calls[0]?.[0]).toBe(source);
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
        fetchPage: session.fetchPage,
        untilDeadline: session.untilDeadline,
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
        fetchPage: session.fetchPage,
        untilDeadline: session.untilDeadline,
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

  it('reports a fetch failure as itself when the Run aborts as it lands', async () => {
    const abort = new AbortController();
    const failThenAbort: typeof createWebFetchSession = (options, deps) => {
      const session = createWebFetchSession(options, deps);
      return {
        fetch: session.fetch,
        fetchPage: async (url) => {
          const response = await session.fetchPage(url);
          abort.abort();
          return response;
        },
        dispose: session.dispose,
        untilDeadline: session.untilDeadline,
      };
    };
    fetchDouble.mockImplementationOnce(() =>
      Promise.resolve(
        new Response('no such page', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      ),
    );
    const execute = webReadExecutor({ createWebFetchSession: failThenAbort });

    const result = await execute(
      webContext({ abortSignal: abort.signal, media: imageStore().media }),
      { operation: 'read', input: { path: 'https://example.test/guide' } },
    );

    expect(result).toMatchObject({ status: 'error', type: 'http_status' });
  });

  describe('an image page', () => {
    const IMAGE_URL = 'https://example.test/shot.png';
    const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

    beforeEach(() => {
      fetchDouble.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(IMAGE_BYTES, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
      );
    });

    it('decodes the body under the call id and returns the image', async () => {
      const { media, decoded } = imageStore();

      const result = await webReadExecutor()(
        webContext({ media, toolCallId: 'call-1' }),
        { operation: 'read', input: { path: IMAGE_URL } },
      );

      expect(result).toStrictEqual({
        ...DECODED_IMAGE,
        kind: 'image',
        path: IMAGE_URL,
        finalUrl: IMAGE_URL,
        method: 'image',
      });
      expect(media.readMedia).toHaveBeenCalledWith(IMAGE_URL, 'call-1');
      expect(decoded).toStrictEqual([
        { byteSize: IMAGE_BYTES.byteLength, bytes: Buffer.from(IMAGE_BYTES) },
      ]);
    });

    it('refuses a selector before anything is decoded', async () => {
      const { media, decoded } = imageStore();

      const result = await webReadExecutor()(webContext({ media }), {
        operation: 'read',
        input: { path: `${IMAGE_URL}:1-5` },
      });

      expect(result).toMatchObject({
        status: 'error',
        type: 'invalid_selector',
      });
      expect(decoded).toStrictEqual([]);
    });
  });

  /** A page the transport returns as PDF bytes, read through the real media
   *  store over the attempt's own memory: the page count comes from a real
   *  parse of the fixture, so a read that skipped preparation could not report
   *  it, and nothing but the read itself can put bytes in the map. */
  describe('an unstored PDF page', () => {
    const CALL_ID = 'call-web-pdf';
    const PDF_URL = 'https://example.test/paper.pdf';
    const PDF_FIXTURES = join(__dirname, '../media/testing/pdf');
    /** An unstored page is served from the attempt, never the store, so a
     *  lookup here means the read took a path it must not have. */
    const mediaService: Pick<MediaService, 'findOwned'> = {
      findOwned: () =>
        Promise.reject(new Error('An unstored PDF looked up the media store.')),
    };
    let paper: Buffer;
    let retained: Map<string, RetainedMedia>;

    const fixture = (name: string): Buffer =>
      readFileSync(join(PDF_FIXTURES, name));

    const pdfPage = (body: Buffer): Response =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });

    const readPdf = (
      path: string = PDF_URL,
      overrides: Partial<ToolContext> = {},
    ): Promise<ToolResult> =>
      webReadExecutor()(
        webContext({
          media: createToolMediaStore(mediaService, 'owner', retained),
          toolCallId: CALL_ID,
          ...overrides,
        }),
        { operation: 'read', input: { path } },
      );

    beforeAll(() => {
      paper = fixture('fifteen-pages.pdf');
    });

    beforeEach(() => {
      retained = new Map<string, RetainedMedia>();
    });

    it('parses the page count and holds the original under the submitted locator', async () => {
      fetchDouble.mockImplementationOnce(() => Promise.resolve(pdfPage(paper)));

      const result = await readPdf();

      expect(result).toStrictEqual({
        status: 'success',
        kind: 'pdf',
        mediaType: 'application/pdf',
        pages: 15,
        byteSize: paper.byteLength,
        path: PDF_URL,
        finalUrl: PDF_URL,
        method: 'pdf',
      });
      expect(retained.get(CALL_ID)).toStrictEqual({
        locator: PDF_URL,
        pages: 15,
        data: paper.toString('base64'),
      });
    });

    it('keeps the pages and the original for a model with no PDF input', async () => {
      fetchDouble.mockImplementationOnce(() => Promise.resolve(pdfPage(paper)));

      const result = await readPdf(PDF_URL);

      expect(result).toStrictEqual({
        status: 'success',
        kind: 'pdf',
        mediaType: 'application/pdf',
        pages: 15,
        byteSize: paper.byteLength,
        path: PDF_URL,
        finalUrl: PDF_URL,
        method: 'pdf',
      });
      expect(retained.get(CALL_ID)).toStrictEqual({
        locator: PDF_URL,
        pages: 15,
        data: paper.toString('base64'),
      });
    });

    it('refuses a page whose head carries markup before the PDF header', async () => {
      // pdf.js finds a `%PDF-` header past the first bytes and parses the
      // whole document from it, so this body is a 15-page PDF to a reader that
      // does not check the page's own head: the refusal can only come from
      // that check.
      fetchDouble.mockImplementationOnce(() =>
        Promise.resolve(pdfPage(Buffer.concat([Buffer.from('<html>'), paper]))),
      );

      const result = await readPdf();

      expect(result).toMatchObject({
        status: 'error',
        type: 'unsupported_media_type',
      });
      expect(retained.size).toBe(0);
    });

    it.each([':raw', ':1-5', ':outline'])(
      'refuses the %s selector instead of preparing the page',
      async (selector) => {
        fetchDouble.mockImplementationOnce(() =>
          Promise.resolve(pdfPage(paper)),
        );

        const result = await readPdf(`${PDF_URL}${selector}`);

        expect(result).toMatchObject({
          status: 'error',
          type: 'invalid_selector',
        });
        expect(retained.size).toBe(0);
      },
    );

    it.each([
      ['owner-password.pdf', 'unsupported_media_type'],
      ['hundred-one-pages.pdf', 'media_too_large'],
    ])(
      'refuses %s as the preparation refusal it is and holds nothing',
      async (name, type) => {
        fetchDouble.mockImplementationOnce(() =>
          Promise.resolve(pdfPage(fixture(name))),
        );

        const result = await readPdf();

        expect(result).toMatchObject({ status: 'error', type });
        expect(retained.size).toBe(0);
      },
    );

    it('refuses a PDF body past the 20 MiB allowance and holds nothing', async () => {
      const oversized = Buffer.concat([
        paper,
        Buffer.alloc(21 * 1024 * 1024 - paper.byteLength, 0x20),
      ]);
      fetchDouble.mockImplementationOnce(() =>
        Promise.resolve(pdfPage(oversized)),
      );

      const result = await readPdf();

      expect(result).toMatchObject({ status: 'error', type: 'body_too_large' });
      expect(retained.size).toBe(0);
    });

    it('refuses the PDF when the read was built without a media store', async () => {
      fetchDouble.mockImplementationOnce(() => Promise.resolve(pdfPage(paper)));

      const result = await webReadExecutor()(webContext(), {
        operation: 'read',
        input: { path: PDF_URL },
      });

      expect(result).toMatchObject({
        status: 'error',
        type: 'unsupported_content_type',
      });
    });

    describe('a call that ends while the page is being prepared', () => {
      // The cases drive the clock themselves, so a failure inside one must not
      // leave fake timers behind for the rest of the file.
      afterEach(() => {
        vi.useRealTimers();
      });

      /** A preparation that reports when it is running and never settles until
       *  the test says so, leaving the call's own bounds to end the read. */
      function pendingPreparation() {
        const { promise: started, resolve: entered } =
          Promise.withResolvers<void>();
        const { promise: prepared, resolve: finish } =
          Promise.withResolvers<number>();
        const parse = vi
          .spyOn(pdfPreparation, 'preparePdf')
          .mockImplementation(() => {
            entered();
            return prepared;
          });
        return { started, finish, restore: () => parse.mockRestore() };
      }

      it.each(['call_timeout', 'aborted'])(
        'returns %s while the preparation runs and holds nothing that lands after',
        async (type) => {
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
          const preparation = pendingPreparation();
          const abort = new AbortController();
          let observed: ToolResult | undefined;
          fetchDouble.mockImplementationOnce(() =>
            Promise.resolve(pdfPage(paper)),
          );
          const pending = readPdf(PDF_URL, {
            abortSignal: abort.signal,
          }).then((result) => {
            observed = result;
            return result;
          });
          const settled = Promise.allSettled([pending]);
          try {
            await preparation.started;
            if (type === 'aborted') abort.abort();
            else await vi.advanceTimersByTimeAsync(30_000);
            await vi.advanceTimersByTimeAsync(0);

            // The read is answered and the attempt is empty while the
            // preparation is still running.
            expect(observed).toMatchObject({ status: 'error', type });
            expect(retained.size).toBe(0);

            preparation.finish(15);
            await vi.advanceTimersByTimeAsync(0);

            expect(retained.size).toBe(0);
          } finally {
            preparation.finish(15);
            await settled;
            preparation.restore();
            vi.useRealTimers();
          }
        },
      );
    });
  });
});
