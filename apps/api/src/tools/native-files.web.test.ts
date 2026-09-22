import type { Mock } from 'vitest';

import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from './native-files';
import { type ToolContext } from './types';
import { createWebReadExecutor } from './web-read/execute';
import { fetchWebDocument } from './web-read/http-client';
import { parseWebLocator } from './web-read/locator';
import { renderWebDocument } from './web-read/pipeline';
import { buildWebReadResult } from './web-read/result';

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
    tenantDb: {
      runAs: () => Promise.reject(new Error('Database unavailable')),
    },
    ...overrides,
  };
}

describe('web locator dispatch', () => {
  let fetchDouble: Mock<typeof globalThis.fetch>;

  beforeEach(() => {
    // The runtime `fetch` the client calls, so the whole tool path runs.
    fetchDouble = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(MARKDOWN, {
          status: 200,
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchDouble);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** One response for the next request, carrying the body a test needs. */
  const respondWith = (body: string, contentType: string): void => {
    fetchDouble.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': contentType },
        }),
      ),
    );
  };

  it('reads an https locator and returns the web result', async () => {
    const result = await nativeReadTool.execute(webContext(), {
      path: 'https://example.test/guide',
    });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: 'https://example.test/guide',
      method: 'negotiated',
    });
    expect(JSON.stringify(result)).toContain('publisher-provided body');
    expect(fetchDouble).toHaveBeenCalledTimes(1);
  });

  it('needs no executor identity and binds none', async () => {
    const runAs = vi.fn(() =>
      Promise.reject(new Error('Database unavailable')),
    );

    const result = await nativeReadTool.execute(
      webContext({ tenantDb: { runAs } }),
      { path: 'https://example.test/guide' },
    );

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: 'https://example.test/guide',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('rejects edit and write on a web locator before any request', async () => {
    const edited = await nativeEditTool.execute(webContext(), {
      path: 'https://example.test/guide',
      oldText: 'a',
      newText: 'b',
    });
    const written = await nativeWriteTool.execute(webContext(), {
      path: 'https://example.test/guide',
      content: 'x',
    });

    for (const result of [edited, written]) {
      expect(result).toMatchObject({
        status: 'error',
        type: 'invalid_path',
      });
      expect(JSON.stringify(result)).toContain('read-only');
    }
    expect(fetchDouble).not.toHaveBeenCalled();
  });

  it('fails closed when the instance identity is missing', async () => {
    const result = await nativeReadTool.execute(
      webContext({ productUserAgent: undefined }),
      { path: 'https://example.test/guide' },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(JSON.stringify(result)).toContain('User-Agent');
    expect(JSON.stringify(result)).not.toContain('/guide');
    expect(fetchDouble).not.toHaveBeenCalled();
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
    expect(fetchDouble).not.toHaveBeenCalled();
  });

  it('reads an http locator through the same branch as https', async () => {
    const result = await nativeReadTool.execute(webContext(), {
      path: 'http://example.test/guide',
    });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: 'http://example.test/guide',
      method: 'negotiated',
    });
    expect(fetchDouble).toHaveBeenCalledTimes(1);
  });

  it('returns the body verbatim for a :raw read', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: 'https://example.test/guide:raw',
    });

    expect(result).toMatchObject({
      status: 'success',
      representation: 'raw',
      method: 'raw',
      content: PAGE_HTML,
      shownRange: { startLine: 1, endLine: PAGE_LINES.length },
    });
  });

  it('returns an unnumbered window for a :raw line selector', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: 'https://example.test/guide:raw:4-5',
    });

    expect(result).toMatchObject({
      status: 'success',
      representation: 'raw',
      method: 'raw',
      content: `${PAGE_LINES[3]}\n${PAGE_LINES[4]}\n`,
      requestedRange: { startLine: 4, endLine: 5 },
      shownRange: { startLine: 4, endLine: 5 },
    });
  });

  it('numbers the converted window for a selector that is not raw', async () => {
    respondWith(PAGE_HTML, 'text/html; charset=utf-8');
    const result = await nativeReadTool.execute(webContext(), {
      path: 'https://example.test/guide:4-5',
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
  });

  it.each([
    ['HTTPS://example.test/guide', 'https://example.test/guide'],
    ['Https://example.test/guide', 'https://example.test/guide'],
    ['HTTP://example.test/guide', 'http://example.test/guide'],
  ])(
    'refuses the uppercase-scheme locator %s before any request',
    async (path, canonical) => {
      const result = await nativeReadTool.execute(webContext(), { path });

      expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
      expect(JSON.stringify(result)).toContain(canonical);
      expect(fetchDouble).not.toHaveBeenCalled();
    },
  );

  it('still reads the lowercase spelling of the same locator', async () => {
    const result = await nativeReadTool.execute(webContext(), {
      path: 'https://example.test/guide',
    });

    expect(result).toMatchObject({
      status: 'success',
      finalUrl: 'https://example.test/guide',
    });
    expect(fetchDouble).toHaveBeenCalledTimes(1);
  });

  it('runs through the collaborators the executor was bound with', async () => {
    const execute = createWebReadExecutor({
      parseWebLocator,
      fetchWebDocument,
      renderWebDocument,
      buildWebReadResult,
      fetch: fetchDouble,
    });

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
    const render = vi.fn(renderWebDocument);
    // The client disposes its deadline, and the listener that reports a caller
    // abort, before the body reaches this layer, so an abort that lands once
    // the fetch has resolved is visible only to the guard under test.
    const fetchThenAbort: typeof fetchWebDocument = async (
      url,
      options,
      deps,
    ) => {
      const response = await fetchWebDocument(url, options, deps);
      abort.abort();
      return response;
    };
    fetchDouble.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(LARGE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    const execute = createWebReadExecutor({
      parseWebLocator,
      fetchWebDocument: fetchThenAbort,
      renderWebDocument: render,
      buildWebReadResult,
      fetch: fetchDouble,
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
});
