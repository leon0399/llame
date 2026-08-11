import { describe, expect, it } from 'vitest';

import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  MCP_STREAMABLE_HTTP_PROTOCOL_VERSIONS,
  type McpFixtureResponse,
} from './mcp-test-fixture';

const ONE_MIB = 1024 * 1024;

async function rpc(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

describe('MCP Streamable HTTP test fixture', () => {
  it.each(MCP_STREAMABLE_HTTP_PROTOCOL_VERSIONS)(
    'creates an initialize response for supported Streamable HTTP revision %s only',
    (protocolVersion) => {
      expect(
        mcpStreamableHttpInitialize({ protocolVersion, sessionId: 'session' }),
      ).toMatchObject({
        kind: 'json',
        headers: { 'mcp-session-id': 'session' },
        body: {
          result: { protocolVersion },
        },
      });
    },
  );

  it('refuses protocol revisions outside the supported session-capable range', () => {
    expect(() =>
      mcpStreamableHttpInitialize({
        protocolVersion: '2026-07-28' as never,
      }),
    ).toThrow('unsupported Streamable HTTP protocol version');
    expect(() =>
      mcpStreamableHttpInitialize({
        protocolVersion: '2024-11-05' as never,
      }),
    ).toThrow('unsupported Streamable HTTP protocol version');
  });

  it('scripts Streamable HTTP GET and session DELETE requests', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });

    try {
      await fetch(fixture.url, { method: 'GET' });
      await fetch(fixture.url, {
        method: 'DELETE',
        headers: { 'mcp-session-id': 'session-sentinel' },
      });

      expect(fixture.requestSummaries()).toEqual([
        expect.objectContaining({ httpMethod: 'GET', rpcMethod: null }),
        expect.objectContaining({ httpMethod: 'DELETE', rpcMethod: null }),
      ]);
      expect(
        fixture.receivedHeader(1, 'mcp-session-id', 'session-sentinel'),
      ).toBe(true);
      expect(JSON.stringify(fixture.requestSummaries())).not.toContain(
        'session-sentinel',
      );
    } finally {
      await fixture.close();
    }
  });

  it('scripts initialize, paginated list, calls, cursor loops, and header assertions without exposing values', async () => {
    const fixture = await createMcpTestFixture({
      initialize: [
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '1.0.0' },
            },
          },
          headers: { 'mcp-session-id': 'session-sentinel' },
        },
      ],
      'tools/list': [
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: [{ name: 'one', inputSchema: {} }],
              nextCursor: 'again',
            },
          },
        },
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: [{ name: 'two', inputSchema: {} }],
              nextCursor: 'again',
            },
          },
        },
      ],
      'tools/call': [
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 1,
            result: { content: [{ type: 'text', text: 'ok' }] },
          },
        },
      ],
    });

    try {
      await rpc(
        fixture.url,
        'initialize',
        {},
        {
          authorization: 'Bearer header-sentinel',
        },
      );
      await rpc(fixture.url, 'tools/list');
      await rpc(fixture.url, 'tools/list', { cursor: 'again' });
      await rpc(fixture.url, 'tools/call', {
        name: 'one',
        arguments: { query: 'safe' },
      });

      expect(
        fixture.receivedHeader(0, 'authorization', 'Bearer header-sentinel'),
      ).toBe(true);
      expect(fixture.requestSummaries()).toEqual([
        expect.objectContaining({ rpcMethod: 'initialize' }),
        expect.objectContaining({ rpcMethod: 'tools/list', cursor: null }),
        expect.objectContaining({ rpcMethod: 'tools/list', cursor: 'again' }),
        expect.objectContaining({ rpcMethod: 'tools/call' }),
      ]);
      expect(JSON.stringify(fixture.requestSummaries())).not.toContain(
        'header-sentinel',
      );
    } finally {
      await fixture.close();
    }
  });

  it('scripts delayed errors, oversized JSON, and oversized SSE events', async () => {
    const oversizedJson = 'j'.repeat(ONE_MIB + 1);
    const oversizedSse = 's'.repeat(ONE_MIB + 1);
    const actions: McpFixtureResponse[] = [
      {
        kind: 'raw',
        status: 503,
        delayMs: 10,
        contentType: 'application/json',
        body: oversizedJson,
      },
      {
        kind: 'sse',
        events: [{ id: '1', data: oversizedSse, rawData: true }],
      },
    ];
    const fixture = await createMcpTestFixture({ 'tools/call': actions });

    try {
      const error = await rpc(fixture.url, 'tools/call');
      expect(error.status).toBe(503);
      expect((await error.text()).length).toBe(ONE_MIB + 1);

      const sse = await rpc(fixture.url, 'tools/call');
      expect(sse.headers.get('content-type')).toContain('text/event-stream');
      expect((await sse.text()).length).toBeGreaterThan(ONE_MIB);
    } finally {
      await fixture.close();
    }
  });

  it('scripts transport disconnect and closes idempotently', async () => {
    const fixture = await createMcpTestFixture({
      'tools/call': [{ kind: 'disconnect' }],
    });

    await expect(rpc(fixture.url, 'tools/call')).rejects.toThrow();
    await fixture.close();
    await fixture.close();
    await expect(rpc(fixture.url, 'tools/call')).rejects.toThrow();
  });
});
