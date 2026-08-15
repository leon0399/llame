import { describe, expect, it, vi } from 'vitest';

import {
  McpBodyLimitError,
  McpRequestLimitError,
  createMcpBoundedFetch,
} from './mcp-bounded-fetch';

function responseFromChunks(
  chunks: readonly Uint8Array[],
  init: ResponseInit = {},
  onCancel = vi.fn(),
  keepOpen = false,
): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) {
          if (!keepOpen) controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel: onCancel,
    }),
    init,
  );
}

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const requestBodyCases = [
  {
    label: 'URLSearchParams',
    body: new URLSearchParams({ value: 'é' }),
    byteLength: 12,
  },
  {
    label: 'ArrayBuffer',
    body: new Uint8Array([0, 1, 2, 3]).buffer,
    byteLength: 4,
  },
  {
    label: 'Uint8Array view',
    body: new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 4),
    byteLength: 3,
  },
  {
    label: 'Blob',
    body: new Blob([new Uint8Array([0xc3, 0xa9])]),
    byteLength: 2,
  },
] as const;

describe('MCP byte-bounded fetch', () => {
  it('forces redirect error and captures the session before returning the response', async () => {
    const seen: RequestInit[] = [];
    let session: string | null = null;
    const boundedFetch = createMcpBoundedFetch({
      fetch: (_input, init) => {
        seen.push(init ?? {});
        return Promise.resolve(
          new Response('{}', {
            headers: { 'mcp-session-id': 'session-sentinel' },
          }),
        );
      },
      maxResponseBytes: 16,
      onSessionId: (value) => {
        session = value;
      },
    });

    const response = await boundedFetch('https://example.invalid', {
      redirect: 'follow',
    });

    expect(seen).toEqual([expect.objectContaining({ redirect: 'error' })]);
    expect(session).toBe('session-sentinel');
    expect(await response.json()).toEqual({});
  });

  it('caps a non-2xx body while response.text consumes it and cancels upstream', async () => {
    const cancelled = vi.fn();
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks(
            [bytes('1234'), bytes('56789')],
            {
              status: 503,
              headers: { 'content-type': 'application/json' },
            },
            cancelled,
            true,
          ),
        ),
      maxResponseBytes: 8,
    });

    const response = await boundedFetch('https://example.invalid');
    await expect(response.text()).rejects.toBeInstanceOf(McpBodyLimitError);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('does not trust a small Content-Length claim', async () => {
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks([bytes('123456789')], {
            headers: { 'content-length': '1' },
          }),
        ),
      maxResponseBytes: 8,
    });

    const response = await boundedFetch('https://example.invalid');
    await expect(response.arrayBuffer()).rejects.toBeInstanceOf(
      McpBodyLimitError,
    );
  });

  it('rejects an oversized claimed body before returning it', async () => {
    const cancelled = vi.fn();
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks(
            [bytes('safe')],
            { headers: { 'content-length': '9' } },
            cancelled,
            true,
          ),
        ),
      maxResponseBytes: 8,
    });

    await expect(
      boundedFetch('https://example.invalid'),
    ).rejects.toBeInstanceOf(McpBodyLimitError);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('caps each SSE event independently instead of the whole stream', async () => {
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks([bytes('data: 1\n\ndata: 2\n\n')], {
            headers: {
              'content-length': '18',
              'content-type': 'text/event-stream',
            },
          }),
        ),
      maxResponseBytes: 9,
    });

    const response = await boundedFetch('https://example.invalid');
    expect(await response.text()).toBe('data: 1\n\ndata: 2\n\n');
  });

  it('caps a non-2xx SSE-labeled body across events and cancels upstream', async () => {
    const cancelled = vi.fn();
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks(
            [bytes('data: 1\n\n'), bytes('data: 2\n\n'), bytes('ignored')],
            {
              status: 503,
              headers: { 'content-type': 'text/event-stream' },
            },
            cancelled,
          ),
        ),
      maxResponseBytes: 9,
    });

    const response = await boundedFetch('https://example.invalid');
    await expect(response.text()).rejects.toBeInstanceOf(McpBodyLimitError);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('resets the byte budget after a CRLF-delimited event at the exact limit', async () => {
    const body = 'data: 1\r\n\r\ndata: 2\r\n\r\n';
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks([bytes(body)], {
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
      maxResponseBytes: 11,
    });

    const response = await boundedFetch('https://example.invalid');
    expect(await response.text()).toBe(body);
  });

  it('rejects one oversized SSE event across chunk boundaries', async () => {
    const cancelled = vi.fn();
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks(
            [bytes('data:'), bytes(' 12345\n\n')],
            { headers: { 'content-type': 'text/event-stream' } },
            cancelled,
            true,
          ),
        ),
      maxResponseBytes: 9,
    });

    const response = await boundedFetch('https://example.invalid');
    await expect(response.text()).rejects.toBeInstanceOf(McpBodyLimitError);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('lets an aggregate consumer abort and cleans up the body', async () => {
    const cancelled = vi.fn();
    let total = 0;
    const boundedFetch = createMcpBoundedFetch({
      fetch: () =>
        Promise.resolve(
          responseFromChunks(
            [bytes('1234'), bytes('5678')],
            {},
            cancelled,
            true,
          ),
        ),
      maxResponseBytes: 16,
      onBytes: (count) => {
        total += count;
        if (total > 4) throw new Error('aggregate limit');
      },
    });

    const response = await boundedFetch('https://example.invalid');
    await expect(response.text()).rejects.toThrow('aggregate limit');
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('identifies the trusted outbound RPC method for aggregate accounting', async () => {
    const observed: Array<{ count: number; rpcMethod: string | null }> = [];
    const boundedFetch = createMcpBoundedFetch({
      fetch: () => Promise.resolve(new Response('{}')),
      maxResponseBytes: 16,
      onBytes: (count, request) =>
        observed.push({
          count,
          rpcMethod: request.rpcMethod,
        }),
    });

    const response = await boundedFetch('https://example.invalid', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    await response.text();

    expect(observed).toEqual([{ count: 2, rpcMethod: 'tools/list' }]);
  });

  it('reports a lower-case init method in upper-case through onBytes', async () => {
    const observed: Array<{
      count: number;
      httpMethod: string;
      rpcMethod: string | null;
    }> = [];
    const boundedFetch = createMcpBoundedFetch({
      fetch: () => Promise.resolve(new Response('{}')),
      maxResponseBytes: 16,
      onBytes: (count, request) => observed.push({ count, ...request }),
    });

    const response = await boundedFetch('https://example.invalid', {
      method: 'post',
    });
    await response.text();

    expect(observed).toEqual([
      { count: 2, httpMethod: 'POST', rpcMethod: null },
    ]);
  });

  it('uses the Request method when init.method is absent', async () => {
    const observed: Array<{
      count: number;
      httpMethod: string;
      rpcMethod: string | null;
    }> = [];
    const boundedFetch = createMcpBoundedFetch({
      fetch: () => Promise.resolve(new Response('{}')),
      maxResponseBytes: 16,
      onBytes: (count, request) => observed.push({ count, ...request }),
    });

    const response = await boundedFetch(
      new Request('https://example.invalid', { method: 'patch' }),
    );
    await response.text();

    expect(observed).toEqual([
      { count: 2, httpMethod: 'PATCH', rpcMethod: null },
    ]);
  });

  it('defaults URL and string inputs to GET', async () => {
    const observed: Array<{
      count: number;
      httpMethod: string;
      rpcMethod: string | null;
    }> = [];
    const boundedFetch = createMcpBoundedFetch({
      fetch: () => Promise.resolve(new Response('{}')),
      maxResponseBytes: 16,
      onBytes: (count, request) => observed.push({ count, ...request }),
    });

    const stringResponse = await boundedFetch('https://example.invalid');
    await stringResponse.text();
    const urlResponse = await boundedFetch(new URL('https://example.invalid'));
    await urlResponse.text();

    expect(observed).toEqual([
      { count: 2, httpMethod: 'GET', rpcMethod: null },
      { count: 2, httpMethod: 'GET', rpcMethod: null },
    ]);
  });

  it('preserves the HTTP method and reports no RPC method for a non-string body', async () => {
    const observed: Array<{
      count: number;
      httpMethod: string;
      rpcMethod: string | null;
    }> = [];
    const boundedFetch = createMcpBoundedFetch({
      fetch: () => Promise.resolve(new Response('{}')),
      maxResponseBytes: 16,
      onBytes: (count, request) => observed.push({ count, ...request }),
    });

    const response = await boundedFetch('https://example.invalid', {
      method: 'put',
      body: new URLSearchParams({ method: 'tools/list' }),
    });
    await response.text();

    expect(observed).toEqual([
      { count: 2, httpMethod: 'PUT', rpcMethod: null },
    ]);
  });

  it.each([
    ['number', 7],
    ['boolean', true],
    ['object', { name: 'tools/list' }],
  ])(
    'reports null for a JSON method with a %s value',
    async (_label, method) => {
      const observed: Array<{
        count: number;
        httpMethod: string;
        rpcMethod: string | null;
      }> = [];
      const boundedFetch = createMcpBoundedFetch({
        fetch: () => Promise.resolve(new Response('{}')),
        maxResponseBytes: 16,
        onBytes: (count, request) => observed.push({ count, ...request }),
      });

      const response = await boundedFetch('https://example.invalid', {
        method: 'post',
        body: JSON.stringify({ method }),
      });
      await response.text();

      expect(observed).toEqual([
        { count: 2, httpMethod: 'POST', rpcMethod: null },
      ]);
    },
  );

  it('reports null for malformed JSON without throwing', async () => {
    const observed: Array<{
      count: number;
      httpMethod: string;
      rpcMethod: string | null;
    }> = [];
    const boundedFetch = createMcpBoundedFetch({
      fetch: () => Promise.resolve(new Response('{}')),
      maxResponseBytes: 16,
      onBytes: (count, request) => observed.push({ count, ...request }),
    });

    const response = await boundedFetch('https://example.invalid', {
      method: 'post',
      body: '{"method":',
    });
    await expect(response.text()).resolves.toBe('{}');

    expect(observed).toEqual([
      { count: 2, httpMethod: 'POST', rpcMethod: null },
    ]);
  });

  it('rejects an oversized serialized tool call before network execution', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')));
    const boundedFetch = createMcpBoundedFetch({
      fetch: fetchSpy,
      maxRequestBytes: 8,
      maxResponseBytes: 16,
    });

    await expect(
      boundedFetch('https://example.invalid', {
        method: 'POST',
        body: JSON.stringify({ method: 'tools/call', params: { q: 'large' } }),
      }),
    ).rejects.toBeInstanceOf(McpRequestLimitError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(requestBodyCases)(
    'enforces the request byte limit for $label bodies',
    async ({ body, byteLength }) => {
      const exactFetch = vi.fn(() => Promise.resolve(new Response('{}')));
      const exactBoundedFetch = createMcpBoundedFetch({
        fetch: exactFetch,
        maxRequestBytes: byteLength,
        maxResponseBytes: 16,
      });

      await expect(
        exactBoundedFetch('https://example.invalid', {
          method: 'POST',
          body,
        }),
      ).resolves.toBeInstanceOf(Response);
      expect(exactFetch).toHaveBeenCalledOnce();

      const belowFetch = vi.fn(() => Promise.resolve(new Response('{}')));
      const belowBoundedFetch = createMcpBoundedFetch({
        fetch: belowFetch,
        maxRequestBytes: byteLength - 1,
        maxResponseBytes: 16,
      });

      await expect(
        belowBoundedFetch('https://example.invalid', {
          method: 'POST',
          body,
        }),
      ).rejects.toBeInstanceOf(McpRequestLimitError);
      expect(belowFetch).not.toHaveBeenCalled();
    },
  );
});
