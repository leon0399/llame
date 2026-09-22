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
    expect(fetchDouble).not.toHaveBeenCalled();
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
});
