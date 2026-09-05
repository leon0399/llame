import { createMCPClient } from '@ai-sdk/mcp';
import { describe, expect, it } from 'vitest';

import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
} from './mcp-test-fixture';

describe('@ai-sdk/mcp public API contract', () => {
  it('initializes over Streamable HTTP, lists definitions, and executes a converted public tool', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: 'session-sentinel' }),
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: [
                {
                  name: 'lookup',
                  description: 'Look up a document.',
                  inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                  },
                },
              ],
              nextCursor: 'next',
            },
          },
        },
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 2,
            result: { tools: [], nextCursor: undefined },
          },
        },
      ],
      'tools/call': [
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 3,
            result: { content: [{ type: 'text', text: 'found' }] },
          },
        },
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });

    let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;

    try {
      client = await createMCPClient({
        transport: {
          type: 'http',
          url: fixture.url,
          headers: { authorization: 'Bearer header-sentinel' },
          redirect: 'error',
        },
        maxRetries: 0,
      });
      const firstPage = await client.listTools();
      const secondPage = await client.listTools({
        params: { cursor: firstPage.nextCursor },
      });
      const tool = client.toolsFromDefinitions(firstPage)['lookup'];
      if (tool === undefined) throw new Error('missing converted lookup tool');

      const result = await tool.execute(
        { query: 'MCP' },
        { toolCallId: 'fixture-call', messages: [], abortSignal: undefined },
      );

      expect(secondPage.tools).toEqual([]);
      expect(result).toEqual({
        content: [{ type: 'text', text: 'found' }],
        isError: false,
      });
      expect(
        fixture
          .requestSummaries()
          .find(({ rpcMethod }) => rpcMethod === 'initialize'),
      ).toMatchObject({ rpcMethod: 'initialize' });
      expect(
        fixture
          .requestSummaries()
          .some(({ httpMethod }) => httpMethod === 'GET'),
      ).toBe(true);
      expect(
        fixture.receivedHeaderMatching(
          ({ rpcMethod }) => rpcMethod === 'initialize',
          'mcp-protocol-version',
          '2025-11-25',
        ),
      ).toBe(true);
      expect(
        fixture.receivedHeaderMatching(
          ({ rpcMethod }) => rpcMethod === 'notifications/initialized',
          'mcp-session-id',
          'session-sentinel',
        ),
      ).toBe(true);
      expect(
        fixture.receivedHeaderMatching(
          ({ rpcMethod }) => rpcMethod === 'initialize',
          'authorization',
          'Bearer header-sentinel',
        ),
      ).toBe(true);
      expect(JSON.stringify(fixture.requestSummaries())).not.toContain(
        'header-sentinel',
      );
      expect(JSON.stringify(fixture.requestSummaries())).not.toContain(
        'session-sentinel',
      );
    } finally {
      await client?.close();
      await fixture.close();
    }
    expect(
      fixture
        .requestSummaries()
        .some(({ httpMethod }) => httpMethod === 'DELETE'),
    ).toBe(true);
  });
});
