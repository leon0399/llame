import { describe, expect, it, vi } from 'vitest';

import { McpBodyLimitError, McpRequestLimitError } from './mcp-bounded-fetch';
import {
  McpSessionChangedError,
  createMcpGuardedFetch,
} from './mcp-guarded-fetch';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

function sessionResponse(
  sessionId: string,
  body: string,
  onCancel = vi.fn(),
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(body));
      },
      cancel: onCancel,
    }),
    { headers: { 'mcp-session-id': sessionId } },
  );
}

describe('MCP session-guarded fetch', () => {
  it('learns the first session id once and accepts its repeats', async () => {
    const onSessionId = vi.fn();
    const sessions = ['session-first', 'session-first', 'session-first'];
    const guardedFetch = createMcpGuardedFetch({
      fetch: () =>
        Promise.resolve(sessionResponse(sessions.shift() ?? '', '{}')),
      maxResponseBytes: 64,
      onSessionId,
    });

    await guardedFetch('https://example.invalid');
    await guardedFetch('https://example.invalid');
    await guardedFetch('https://example.invalid');

    expect(onSessionId).toHaveBeenCalledOnce();
    expect(onSessionId).toHaveBeenCalledWith('session-first');
  });

  it('refuses a changed session id and cancels the response body', async () => {
    const onSessionId = vi.fn();
    const cancelled = vi.fn();
    const responses = [
      () => sessionResponse('session-first', '{}'),
      () => sessionResponse('session-second', '{}', cancelled),
    ];
    const guardedFetch = createMcpGuardedFetch({
      fetch: () => {
        const next = responses.shift();
        if (next === undefined) throw new Error('unexpected request');
        return Promise.resolve(next());
      },
      maxResponseBytes: 64,
      onSessionId,
    });

    await guardedFetch('https://example.invalid/first');

    await expect(
      guardedFetch('https://example.invalid/second'),
    ).rejects.toBeInstanceOf(McpSessionChangedError);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(onSessionId).toHaveBeenCalledOnce();
    expect(onSessionId).toHaveBeenCalledWith('session-first');
  });

  it('treats an absent or empty session header as no session at all', async () => {
    const onSessionId = vi.fn();
    const headers: Array<Record<string, string>> = [
      {},
      { 'mcp-session-id': '' },
    ];
    const guardedFetch = createMcpGuardedFetch({
      fetch: () =>
        Promise.resolve(new Response('{}', { headers: headers.shift() ?? {} })),
      maxResponseBytes: 64,
      onSessionId,
    });

    await guardedFetch('https://example.invalid');
    await guardedFetch('https://example.invalid');

    expect(onSessionId).not.toHaveBeenCalled();
  });

  it('bounds the response body before it is consumed', async () => {
    const guardedFetch = createMcpGuardedFetch({
      fetch: () =>
        Promise.resolve(sessionResponse('session-first', '12345678')),
      maxResponseBytes: 4,
    });

    const response = await guardedFetch('https://example.invalid');

    await expect(response.text()).rejects.toBeInstanceOf(McpBodyLimitError);
  });

  it('refuses an oversized request before calling the server', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{}')));
    const guardedFetch = createMcpGuardedFetch({
      fetch,
      maxRequestBytes: 4,
      maxResponseBytes: 64,
    });

    await expect(
      guardedFetch('https://example.invalid', {
        method: 'POST',
        body: '{"jsonrpc":"2.0"}',
      }),
    ).rejects.toBeInstanceOf(McpRequestLimitError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forces redirect error and reports every received chunk to onBytes', async () => {
    const onBytes = vi.fn();
    const seen: Array<RequestInit> = [];
    const guardedFetch = createMcpGuardedFetch({
      fetch: (_input, init) => {
        seen.push(init ?? {});
        return Promise.resolve(
          new Response('{"ok":true}', {
            headers: { 'mcp-session-id': 'session-first' },
          }),
        );
      },
      maxResponseBytes: 64,
      onBytes,
    });

    const response = await guardedFetch('https://example.invalid', {
      redirect: 'follow',
    });

    expect(seen).toEqual([expect.objectContaining({ redirect: 'error' })]);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(onBytes).toHaveBeenCalledWith(
      '{"ok":true}'.length,
      expect.objectContaining({ httpMethod: 'GET' }),
    );
  });
});
