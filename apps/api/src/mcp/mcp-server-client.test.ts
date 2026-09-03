import { describe, expect, it, vi } from 'vitest';

import {
  McpDiscoveryLimitError,
  McpProtocolUnsupportedError,
  McpServerOperationError,
  McpServerClient,
  type McpCallOutcome,
  type McpDiscoveredTool,
} from './mcp-server-client';
import { McpBodyLimitError, McpRequestLimitError } from './mcp-bounded-fetch';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  type McpFixtureResponse,
} from './mcp-test-fixture';
import { isRecord, type UnknownRecord } from '../unknown-record';

const emptyToolSchema = { type: 'object' as const, properties: {} };
const ONE_MIB = 1024 * 1024;
const resolvedResponse = (response: Response): Promise<Response> =>
  Promise.resolve(response);
const textEncoder = new TextEncoder();

function openSseResponse(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- test fixture: JSON.stringify'd verbatim into a fake SSE frame below; the actual use is nested inside the ReadableStream's `start()` callback, several scopes past this function's own first statement, so the caller controls the fixture's payload shape by design.
  message: unknown,
  onCancel: () => void,
  closeAfterMs = 250,
): Response {
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          textEncoder.encode(`data: ${JSON.stringify(message)}\n\n`),
        );
        closeTimer = setTimeout(() => controller.close(), closeAfterMs);
      },
      cancel() {
        if (closeTimer !== undefined) clearTimeout(closeTimer);
        onCancel();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function tool(name: string, extra: UnknownRecord = {}) {
  return {
    name,
    description: `Use ${name}.`,
    inputSchema: emptyToolSchema,
    ...extra,
  };
}

function hasStringInitBody(
  init: RequestInit | undefined,
): init is RequestInit & { body: string } {
  return typeof init?.body === 'string';
}

function assertStringInitBody(
  init: RequestInit | undefined,
): asserts init is RequestInit & { body: string } {
  if (!hasStringInitBody(init)) {
    throw new TypeError('expected a string MCP request body');
  }
}

function assertRpcRequestBody(
  body: UnknownRecord,
): asserts body is { method: string; id?: number } {
  const { method, id } = body;
  if (
    typeof method !== 'string' ||
    (id !== undefined && typeof id !== 'number')
  ) {
    throw new TypeError('expected a valid MCP request body');
  }
}

function requestBody(init: RequestInit | undefined): {
  readonly id?: number;
  readonly method: string;
} {
  assertStringInitBody(init);
  let body: unknown;
  try {
    body = JSON.parse(init.body);
  } catch {
    throw new TypeError('expected a valid MCP request body');
  }
  if (!isRecord(body)) {
    throw new TypeError('expected a valid MCP request body');
  }
  assertRpcRequestBody(body);
  return body.id === undefined
    ? { method: body.method }
    : { id: body.id, method: body.method };
}

function jsonRpcResult(
  id: number,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- test fixture helper: builds an arbitrary fake JSON-RPC 2.0 `result` payload embedded verbatim in the response body, so each call site controls its shape to simulate a different MCP server response.
  result: unknown,
): Extract<McpFixtureResponse, { kind: 'json' }> {
  return {
    kind: 'json',
    body: { jsonrpc: '2.0', id, result },
  };
}

function initializedFixtureScripts(input: {
  protocolVersion?: '2025-03-26' | '2025-06-18' | '2025-11-25';
  listResponses: ReadonlyArray<McpFixtureResponse>;
  callResponses?: ReadonlyArray<McpFixtureResponse>;
  deleteResponses?: ReadonlyArray<McpFixtureResponse>;
}) {
  return {
    $get: [{ kind: 'raw', status: 405, body: '' }],
    initialize: [
      mcpStreamableHttpInitialize({
        protocolVersion: input.protocolVersion,
        sessionId: 'session-sentinel',
      }),
    ],
    'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
    'tools/list': input.listResponses,
    ...(input.callResponses !== undefined && {
      'tools/call': input.callResponses,
    }),
    $delete: input.deleteResponses ?? [{ kind: 'raw', status: 204, body: '' }],
  } satisfies Readonly<Record<string, ReadonlyArray<McpFixtureResponse>>>;
}

async function connectFixture(input: {
  protocolVersion?: '2025-03-26' | '2025-06-18' | '2025-11-25';
  listResponses: ReadonlyArray<McpFixtureResponse>;
  callResponses?: ReadonlyArray<McpFixtureResponse>;
  deleteResponses?: ReadonlyArray<McpFixtureResponse>;
}) {
  const fixture = await createMcpTestFixture(initializedFixtureScripts(input));
  const client = await McpServerClient.connect({
    serverId: 'web',
    url: fixture.url,
    headers: { authorization: 'Bearer header-sentinel' },
  });
  return { fixture, client };
}

async function cleanup(input: {
  client?: McpServerClient;
  fixture: Awaited<ReturnType<typeof createMcpTestFixture>>;
}): Promise<void> {
  await input.client?.close();
  await input.fixture.close();
}

function byId(
  tools: ReadonlyArray<McpDiscoveredTool>,
  id: string,
): McpDiscoveredTool {
  const discovered = tools.find(({ definition }) => definition.id === id);
  if (discovered === undefined) throw new Error(`missing ${id}`);
  return discovered;
}

describe('McpServerClient', () => {
  it('reports successful inbound GET-SSE EOF only after connection completes', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'sse', events: [] }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 202, body: '' }],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    let connected = false;
    const connectedAtNotify: Array<boolean> = [];
    const onDisconnect = vi.fn(() => {
      connectedAtNotify.push(connected);
    });
    let client: McpServerClient | undefined;

    try {
      client = await McpServerClient.connect({
        serverId: 'web',
        url: fixture.url,
        onDisconnect,
      });
      connected = true;
      await vi.waitFor(() => {
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
      expect(connectedAtNotify).toEqual([true]);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('reports an inbound GET network rejection only after connection completes', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'disconnect', delayMs: 25 }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 202, body: '' }],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    let connected = false;
    const connectedAtNotify: Array<boolean> = [];
    const onDisconnect = vi.fn(() => {
      connectedAtNotify.push(connected);
    });
    let client: McpServerClient | undefined;

    try {
      client = await McpServerClient.connect({
        serverId: 'web',
        url: fixture.url,
        onDisconnect,
      });
      connected = true;
      await vi.waitFor(() => {
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
      expect(connectedAtNotify).toEqual([true]);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it.each([
    {
      name: 'non-405 HTTP failure',
      response: { kind: 'raw', status: 503, body: 'offline' },
    },
    {
      name: 'successful response with the wrong content type',
      response: {
        kind: 'raw',
        status: 200,
        contentType: 'application/json',
        body: '{}',
      },
    },
  ] satisfies ReadonlyArray<{
    readonly name: string;
    readonly response: McpFixtureResponse;
  }>)(
    'reports inbound GET $name instead of silently retaining the client',
    async ({ response }) => {
      const onDisconnect = vi.fn();
      const fixture = await createMcpTestFixture({
        $get: [response],
        initialize: [mcpStreamableHttpInitialize()],
        'notifications/initialized': [{ kind: 'raw', status: 202, body: '' }],
        $delete: [{ kind: 'raw', status: 204, body: '' }],
      });
      const client = await McpServerClient.connect({
        serverId: 'web',
        url: fixture.url,
        onDisconnect,
      });

      try {
        await vi.waitFor(() => {
          expect(onDisconnect).toHaveBeenCalledTimes(1);
        });
      } finally {
        await cleanup({ client, fixture });
      }
    },
  );

  it('reports a successful inbound GET response with no body', async () => {
    const onDisconnect = vi.fn();
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === 'GET') {
          return resolvedResponse(
            new Response(null, {
              headers: { 'content-type': 'text/event-stream' },
            }),
          );
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return resolvedResponse(new Response(null, { status: 202 }));
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
      onDisconnect,
    });

    try {
      await vi.waitFor(() => {
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
    } finally {
      await client.close();
    }
  });

  it('reports inbound EOF while a request-scoped POST remains in flight', async () => {
    const onDisconnect = vi.fn();
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'sse', events: [], delayMs: 150 }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 202, body: '' }],
      'tools/list': [jsonRpcResult(1, { tools: [tool('lookup')] })],
      'tools/call': [
        {
          ...jsonRpcResult(2, { content: [{ type: 'text', text: 'done' }] }),
          delayMs: 300,
        },
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
      onDisconnect,
    });

    try {
      const catalog = await client.discover();
      const call = byId(catalog.tools, 'mcp__web__lookup').execute(
        {},
        { toolCallId: 'call', messages: [], abortSignal: undefined },
      );
      await vi.waitFor(() => {
        expect(
          fixture
            .requestSummaries()
            .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
        ).toHaveLength(1);
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
      await expect(call).resolves.toMatchObject({ disposition: 'none' });
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('suppresses inbound stream cancellation caused by explicit close', async () => {
    let inboundCancelled = false;
    let inboundStarted = false;
    const onDisconnect = vi.fn();
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === 'GET') {
          inboundStarted = true;
          return resolvedResponse(
            new Response(
              new ReadableStream<Uint8Array>({
                cancel() {
                  inboundCancelled = true;
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } },
            ),
          );
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return resolvedResponse(new Response(null, { status: 202 }));
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
      onDisconnect,
    });

    await vi.waitFor(() => {
      expect(inboundStarted).toBe(true);
    });
    await client.close();
    expect(inboundCancelled).toBe(true);
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it('reports inbound GET session churn exactly once without exposing either id', async () => {
    const onDisconnect = vi.fn();
    let inboundCancelled = false;
    let resolveInbound: ((response: Response) => void) | undefined;
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === 'GET') {
          if (resolveInbound !== undefined) {
            return new Promise<Response>(() => undefined);
          }
          return new Promise<Response>((resolve) => {
            resolveInbound = resolve;
          });
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              }),
              {
                headers: {
                  'content-type': 'application/json',
                  'mcp-session-id': 'session-old-sentinel',
                },
              },
            ),
          );
        }
        if (request.method === 'notifications/initialized') {
          resolveInbound?.(
            new Response(
              new ReadableStream<Uint8Array>({
                cancel() {
                  inboundCancelled = true;
                },
              }),
              {
                headers: {
                  'content-type': 'text/event-stream',
                  'mcp-session-id': 'session-new-sentinel',
                },
              },
            ),
          );
          return resolvedResponse(new Response(null, { status: 202 }));
        }
        return Promise.reject(new Error('unexpected request'));
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
      onDisconnect,
    });

    try {
      await vi.waitFor(() => {
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
      expect(onDisconnect).toHaveBeenCalledWith();
      expect(JSON.stringify(onDisconnect.mock.calls)).not.toMatch(
        /session-(?:old|new)-sentinel/u,
      );
      expect(inboundCancelled).toBe(true);
    } finally {
      await client.close();
    }
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('does not fan a request-scoped POST rejection out through the disconnect callback', async () => {
    const onDisconnect = vi.fn();
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [jsonRpcResult(1, { tools: [tool('lookup')] })],
      'tools/call': [
        {
          kind: 'raw',
          status: 401,
          contentType: 'application/json',
          body: 'request rejected',
        },
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
      onDisconnect,
    });

    try {
      const catalog = await client.discover();
      await byId(catalog.tools, 'mcp__web__lookup').execute(
        {},
        { toolCallId: 'call', messages: [], abortSignal: undefined },
      );
      await Promise.resolve();
      expect(onDisconnect).not.toHaveBeenCalled();
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it.each(['2025-03-26', '2025-06-18', '2025-11-25'] as const)(
    'discovers every page and exposes package execution closures for protocol %s only after completion',
    async (protocolVersion) => {
      const { fixture, client } = await connectFixture({
        protocolVersion,
        listResponses: [
          jsonRpcResult(1, {
            tools: [tool('first')],
            nextCursor: 'page-2',
          }),
          jsonRpcResult(2, { tools: [tool('second')] }),
        ],
        callResponses: [
          jsonRpcResult(3, {
            content: [{ type: 'text', text: 'found' }],
          }),
        ],
      });

      try {
        const catalog = await client.discover();

        expect(catalog.tools.map(({ definition }) => definition.id)).toEqual([
          'mcp__web__first',
          'mcp__web__second',
        ]);
        expect(catalog.refused).toEqual([]);
        expect(
          fixture
            .requestSummaries()
            .filter(({ rpcMethod }) => rpcMethod === 'tools/list'),
        ).toEqual([
          expect.objectContaining({ cursor: null }),
          expect.objectContaining({ cursor: 'page-2' }),
        ]);

        const result = await byId(catalog.tools, 'mcp__web__first').execute(
          { query: 'MCP' },
          {
            toolCallId: 'call-1',
            messages: [],
            abortSignal: undefined,
          },
        );
        expect(result).toEqual({
          disposition: 'none',
          result: {
            status: 'success',
            output: {
              content: [{ type: 'text', text: 'found' }],
              isError: false,
            },
          },
        });
        expect(
          fixture
            .requestSummaries()
            .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
        ).toHaveLength(1);
      } finally {
        await cleanup({ client, fixture });
      }
    },
  );

  it.each(['2024-11-05', '2026-07-28'])(
    'rejects unsupported protocol %s without completing the initialized notification',
    async (protocolVersion) => {
      const fixture = await createMcpTestFixture({
        $get: [{ kind: 'raw', status: 405, body: '' }],
        initialize: [
          jsonRpcResult(0, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1.0.0' },
          }),
        ],
        'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      });
      let client: McpServerClient | undefined;

      try {
        await expect(async () => {
          client = await McpServerClient.connect({
            serverId: 'web',
            url: fixture.url,
          });
        }).rejects.toBeInstanceOf(McpProtocolUnsupportedError);
        expect(
          fixture
            .requestSummaries()
            .some(({ rpcMethod }) => rpcMethod === 'notifications/initialized'),
        ).toBe(false);
      } finally {
        await cleanup({ client, fixture });
      }
    },
  );

  it('checks the protocol version on the matching initialize response id, not a batch decoy', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        {
          kind: 'sse',
          events: [
            {
              data: {
                jsonrpc: '2.0',
                id: '0',
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'decoy', version: '1.0.0' },
                },
              },
            },
            {
              data: {
                jsonrpc: '2.0',
                id: 0,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              },
            },
          ],
        },
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
    });
    let client: McpServerClient | undefined;

    try {
      await expect(async () => {
        client = await McpServerClient.connect({
          serverId: 'web',
          url: fixture.url,
        });
      }).rejects.toBeInstanceOf(McpProtocolUnsupportedError);
      expect(
        fixture
          .requestSummaries()
          .some(({ rpcMethod }) => rpcMethod === 'notifications/initialized'),
      ).toBe(false);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('rejects a wrong-type JSON response id instead of allowing package coercion', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: '1',
            result: { tools: [tool('coerced')] },
          },
        },
      ],
    });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpServerOperationError',
        stage: 'discovery',
        kind: 'malformed_protocol',
        disposition: 'reconnect',
      } satisfies Partial<McpServerOperationError>);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('accepts a supported initialize response delivered as POST SSE', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        {
          kind: 'sse',
          events: [
            {
              data: {
                jsonrpc: '2.0',
                id: 0,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              },
            },
          ],
        },
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [jsonRpcResult(1, { tools: [] })],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    let client: McpServerClient | undefined;

    try {
      client = await McpServerClient.connect({
        serverId: 'web',
        url: fixture.url,
      });
      await expect(client.discover()).resolves.toMatchObject({ tools: [] });
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('refuses an unsupported initialize response with mixed LF/CRLF SSE boundaries', async () => {
    let initializedNotificationSent = false;
    const initializeEvent = `data: ${JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      },
    })}\n\r\n`;
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return resolvedResponse(new Response('', { status: 405 }));
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(initializeEvent, {
              headers: { 'content-type': 'text/event-stream' },
            }),
          );
        }
        if (request.method === 'notifications/initialized') {
          initializedNotificationSent = true;
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        throw new Error('unexpected request');
      },
    );

    await expect(
      McpServerClient.connect({
        serverId: 'web',
        url: 'https://fixture.invalid/mcp',
        fetch: fetchStub,
      }),
    ).rejects.toBeInstanceOf(McpProtocolUnsupportedError);
    expect(initializedNotificationSent).toBe(false);
  });

  it('accepts a supported initialize response with CR-only SSE boundaries', async () => {
    let initializedNotificationSent = false;
    const initializeEvent = `data: ${JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      },
    })}\r\r`;
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return resolvedResponse(new Response('', { status: 405 }));
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(initializeEvent, {
              headers: { 'content-type': 'text/event-stream' },
            }),
          );
        }
        if (request.method === 'notifications/initialized') {
          initializedNotificationSent = true;
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        throw new Error('unexpected request');
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
    });

    try {
      expect(initializedNotificationSent).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('ignores initialize decoys from SSE event types the package ignores', async () => {
    const initializeEvent = [
      'event: ignored',
      `data: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'decoy', version: '1.0.0' },
        },
      })}`,
      '',
      `data: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture', version: '1.0.0' },
        },
      })}`,
      '',
      '',
    ].join('\n');
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return resolvedResponse(new Response('', { status: 405 }));
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(initializeEvent, {
              headers: { 'content-type': 'text/event-stream' },
            }),
          );
        }
        return resolvedResponse(new Response(null, { status: 204 }));
      },
    );
    let client: McpServerClient | undefined;

    try {
      await expect(async () => {
        client = await McpServerClient.connect({
          serverId: 'web',
          url: 'https://fixture.invalid/mcp',
          fetch: fetchStub,
        });
      }).rejects.toBeInstanceOf(McpProtocolUnsupportedError);
    } finally {
      await client?.close();
    }
  });

  it('cancels each POST-SSE reader immediately after its matching response', async () => {
    let listReaderCancelled = false;
    let callReaderCancelled = false;
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === 'GET') {
          return resolvedResponse(new Response('', { status: 405 }));
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (request.method === 'notifications/initialized') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        if (request.method === 'tools/list') {
          return resolvedResponse(
            openSseResponse(
              {
                jsonrpc: '2.0',
                id: request.id,
                result: { tools: [tool('lookup')] },
              },
              () => {
                listReaderCancelled = true;
              },
            ),
          );
        }
        if (request.method === 'tools/call') {
          return resolvedResponse(
            openSseResponse(
              {
                jsonrpc: '2.0',
                id: request.id,
                result: { content: [{ type: 'text', text: 'done' }] },
              },
              () => {
                callReaderCancelled = true;
              },
            ),
          );
        }
        return Promise.reject(new Error('unexpected request'));
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
    });

    try {
      const catalog = await client.discover();
      expect(listReaderCancelled).toBe(true);
      await expect(
        byId(catalog.tools, 'mcp__web__lookup').execute(
          {},
          { toolCallId: 'call', messages: [], abortSignal: undefined },
        ),
      ).resolves.toMatchObject({ disposition: 'none' });
      expect(callReaderCancelled).toBe(true);
    } finally {
      await client.close();
    }
  });

  it.each(['json', 'sse'] as const)(
    'closes an oversized %s initialize response behind the safe body-limit failure',
    async (kind) => {
      const secret = `AUTH-SENTINEL${'x'.repeat(ONE_MIB)}`;
      const initializeResponse: McpFixtureResponse =
        kind === 'json'
          ? {
              kind: 'raw',
              contentType: 'application/json',
              body: JSON.stringify({ secret }),
            }
          : {
              kind: 'sse',
              events: [{ data: secret, rawData: true }],
            };
      const fixture = await createMcpTestFixture({
        $get: [{ kind: 'raw', status: 405, body: '' }],
        initialize: [initializeResponse],
        $delete: [{ kind: 'raw', status: 204, body: '' }],
      });

      try {
        const connection = McpServerClient.connect({
          serverId: 'web',
          url: fixture.url,
        });
        await expect(connection).rejects.toMatchObject({
          name: 'McpServerOperationError',
          stage: 'initialize',
          kind: 'body_limit',
          disposition: 'reconnect',
        } satisfies Partial<McpServerOperationError>);
        await expect(connection).rejects.not.toThrow('AUTH-SENTINEL');
      } finally {
        await fixture.close();
      }
    },
  );

  it.each([
    {
      name: 'HTTP failure',
      response: {
        kind: 'raw',
        status: 401,
        body: 'AUTH-SENTINEL must not escape',
      } satisfies McpFixtureResponse,
      kind: 'http',
    },
    {
      name: 'malformed JSON',
      response: {
        kind: 'raw',
        body: '{"secret":"AUTH-SENTINEL"',
        contentType: 'application/json',
      } satisfies McpFixtureResponse,
      kind: 'malformed_protocol',
    },
  ] as const)(
    'closes $name initialization failures behind the classified control-plane boundary',
    async ({ response, kind }) => {
      const fixture = await createMcpTestFixture({
        $get: [{ kind: 'raw', status: 405, body: '' }],
        initialize: [response],
        $delete: [{ kind: 'raw', status: 204, body: '' }],
      });

      try {
        const connection = McpServerClient.connect({
          serverId: 'web',
          url: fixture.url,
        });
        await expect(connection).rejects.toMatchObject({
          name: 'McpServerOperationError',
          stage: 'initialize',
          kind,
          disposition: 'reconnect',
        } satisfies Partial<McpServerOperationError>);
        await expect(connection).rejects.not.toThrow('AUTH-SENTINEL');
      } finally {
        await fixture.close();
      }
    },
  );

  it('refuses an unsupported protocol delivered as POST SSE before initialized notification', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        {
          kind: 'sse',
          events: [
            {
              data: {
                jsonrpc: '2.0',
                id: 0,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              },
            },
          ],
        },
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
    });

    try {
      await expect(
        McpServerClient.connect({ serverId: 'web', url: fixture.url }),
      ).rejects.toBeInstanceOf(McpProtocolUnsupportedError);
      expect(
        fixture
          .requestSummaries()
          .some(({ rpcMethod }) => rpcMethod === 'notifications/initialized'),
      ).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it('rejects a repeated discovery cursor instead of publishing the partial catalog', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [
        jsonRpcResult(1, {
          tools: [tool('first')],
          nextCursor: 'loop',
        }),
        jsonRpcResult(2, {
          tools: [tool('second')],
          nextCursor: 'loop',
        }),
      ],
    });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'repeated_cursor',
      } satisfies Partial<McpDiscoveryLimitError>);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('rejects a page containing more than 256 tools', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [
        jsonRpcResult(1, {
          tools: Array.from({ length: 257 }, (_, index) =>
            tool(`tool_${index}`),
          ),
        }),
      ],
    });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'tools_per_page',
      } satisfies Partial<McpDiscoveryLimitError>);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('rejects more than 1,000 tools across otherwise valid pages', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, offset) =>
        tool(`tool_${start + offset}`),
      );
    const { fixture, client } = await connectFixture({
      listResponses: [
        jsonRpcResult(1, { tools: page(0, 250), nextCursor: '2' }),
        jsonRpcResult(2, { tools: page(250, 250), nextCursor: '3' }),
        jsonRpcResult(3, { tools: page(500, 250), nextCursor: '4' }),
        jsonRpcResult(4, { tools: page(750, 251) }),
      ],
    });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'tools_total',
      } satisfies Partial<McpDiscoveryLimitError>);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('refuses only declarations exceeding 256 KiB or schema depth 64', async () => {
    type DeepSchemaFixture =
      | { type: 'string' }
      | { type: 'object'; properties: { nested: DeepSchemaFixture } };
    let deepSchema: DeepSchemaFixture = { type: 'string' };
    for (let depth = 0; depth < 70; depth += 1) {
      deepSchema = {
        type: 'object',
        properties: { nested: deepSchema },
      };
    }
    const { fixture, client } = await connectFixture({
      listResponses: [
        jsonRpcResult(1, {
          tools: [
            tool('too_large', { description: 'x'.repeat(256 * 1024) }),
            tool('too_deep', { inputSchema: deepSchema }),
            tool('safe'),
          ],
        }),
      ],
    });

    try {
      const catalog = await client.discover();
      expect(catalog.tools.map(({ definition }) => definition.id)).toEqual([
        'mcp__web__safe',
      ]);
      expect(catalog.refused).toEqual([
        {
          index: 0,
          id: 'mcp__web__too_large',
          reason: 'declaration_too_large',
        },
        {
          index: 1,
          id: 'mcp__web__too_deep',
          reason: 'schema_too_deep',
        },
      ]);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('rejects an admitted catalog retaining more than 4 MiB', async () => {
    const largeTools = Array.from({ length: 17 }, (_, index) =>
      tool(`large_${index}`, { description: 'd'.repeat(250 * 1024) }),
    );
    const listResponses = Array.from({ length: 6 }, (_, pageIndex) => {
      const pageTools = largeTools.slice(pageIndex * 3, pageIndex * 3 + 3);
      return jsonRpcResult(pageIndex + 1, {
        tools: pageTools,
        ...(pageIndex !== 5 && { nextCursor: `page-${pageIndex + 2}` }),
      });
    });
    const { fixture, client } = await connectFixture({ listResponses });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'retained_catalog_bytes',
      } satisfies Partial<McpDiscoveryLimitError>);
    } finally {
      await cleanup({ client, fixture });
    }
  }, 15_000);

  it('rejects discovery after consuming more than 8 MiB across bounded pages', async () => {
    const listResponses = Array.from({ length: 9 }, (_, pageIndex) =>
      jsonRpcResult(pageIndex + 1, {
        tools: [],
        padding: 'p'.repeat(950 * 1024),
        ...(pageIndex !== 8 && { nextCursor: `page-${pageIndex + 2}` }),
      }),
    );
    const { fixture, client } = await connectFixture({ listResponses });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'response_bytes',
      } satisfies Partial<McpDiscoveryLimitError>);
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/list').length,
      ).toBeLessThanOrEqual(9);
    } finally {
      await cleanup({ client, fixture });
    }
  }, 15_000);

  it('enforces the independent 1,000-page ceiling even for empty pages', async () => {
    const listResponses = Array.from({ length: 1000 }, (_, pageIndex) =>
      jsonRpcResult(pageIndex + 1, {
        tools: [],
        nextCursor: `page-${pageIndex + 2}`,
      }),
    );
    const { fixture, client } = await connectFixture({ listResponses });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'pages',
      } satisfies Partial<McpDiscoveryLimitError>);
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/list'),
      ).toHaveLength(1000);
    } finally {
      await cleanup({ client, fixture });
    }
  }, 60_000);

  it('aborts the active request at the aggregate 30-second discovery deadline', async () => {
    let listAborted = false;
    const fetchStub = vi.fn(
      async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response('', { status: 405 });
        }
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'fixture', version: '1.0.0' },
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }
        if (request.method === 'notifications/initialized') {
          return new Response(null, { status: 204 });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              listAborted = true;
              reject(new Error('request aborted'));
            },
            { once: true },
          );
        });
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
    });
    vi.useFakeTimers();
    const discovery = client.discover();
    const observed = Promise.race([
      discovery,
      new Promise<'missed-deadline'>((resolve) =>
        setTimeout(() => resolve('missed-deadline'), 31_000),
      ),
    ]);

    try {
      const rejection = observed.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(rejection).resolves.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'deadline',
      } satisfies Partial<McpDiscoveryLimitError>);
      expect(listAborted).toBe(true);
    } finally {
      vi.useRealTimers();
      await client.close();
      await discovery.catch(() => undefined);
    }
  });

  it('refuses a complete catalog when the monotonic deadline expires during admission', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [
        jsonRpcResult(1, {
          tools: [tool('first'), tool('second'), tool('third')],
        }),
      ],
    });
    let clockReads = 0;
    const monotonicClock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => (++clockReads >= 33 ? 30_000 : 0));

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpDiscoveryLimitError',
        limit: 'deadline',
      } satisfies Partial<McpDiscoveryLimitError>);
    } finally {
      monotonicClock.mockRestore();
      await cleanup({ client, fixture });
    }
  });

  it.each(['json', 'sse'] as const)(
    'enforces the 1 MiB pre-parse cap on %s discovery input',
    async (kind) => {
      const oversized = 'x'.repeat(ONE_MIB + 1);
      const response: McpFixtureResponse =
        kind === 'json'
          ? {
              kind: 'raw',
              contentType: 'application/json',
              body: oversized,
            }
          : {
              kind: 'sse',
              events: [{ data: oversized, rawData: true }],
            };
      const { fixture, client } = await connectFixture({
        listResponses: [response],
      });

      try {
        await expect(client.discover()).rejects.toMatchObject({
          name: 'McpServerOperationError',
          stage: 'discovery',
          kind: 'body_limit',
          disposition: 'reconnect',
        } satisfies Partial<McpServerOperationError>);
      } finally {
        await cleanup({ client, fixture });
      }
    },
  );

  it('retains a constructor name when the package creates an own executor', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [jsonRpcResult(1, { tools: [tool('constructor')] })],
    });

    try {
      const catalog = await client.discover();
      expect(catalog.tools.map(({ definition }) => definition.id)).toEqual([
        'mcp__web__constructor',
      ]);
      expect(catalog.refused).toEqual([]);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('isolates a raw name for which the package cannot create an own executor', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [
        jsonRpcResult(1, { tools: [tool('__proto__'), tool('safe')] }),
      ],
    });

    try {
      const catalog = await client.discover();
      expect(catalog.tools.map(({ definition }) => definition.id)).toEqual([
        'mcp__web__safe',
      ]);
      expect(catalog.refused).toEqual([
        {
          index: 0,
          id: 'mcp__web__proto',
          reason: 'invalid_declaration',
        },
      ]);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('accepts repeated copies of one stable MCP session id', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: 'session-sentinel' }),
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [
        {
          ...jsonRpcResult(1, { tools: [tool('lookup')] }),
          headers: { 'mcp-session-id': 'session-sentinel' },
        },
      ],
      'tools/call': [
        {
          ...jsonRpcResult(2, { content: [{ type: 'text', text: 'done' }] }),
          headers: { 'mcp-session-id': 'session-sentinel' },
        },
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
    });

    try {
      const catalog = await client.discover();
      await expect(
        byId(catalog.tools, 'mcp__web__lookup').execute(
          {},
          { toolCallId: 'call', messages: [], abortSignal: undefined },
        ),
      ).resolves.toMatchObject({ disposition: 'none' });
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('rejects a changed MCP session id without exposing either id', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: 'session-old-sentinel' }),
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [
        {
          ...jsonRpcResult(1, { tools: [tool('lookup')] }),
          headers: { 'mcp-session-id': 'session-new-sentinel' },
        },
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
    });

    try {
      const discovery = client.discover();
      await expect(discovery).rejects.toMatchObject({
        name: 'McpServerOperationError',
        stage: 'discovery',
        kind: 'malformed_protocol',
        disposition: 'reconnect',
      } satisfies Partial<McpServerOperationError>);
      await expect(discovery).rejects.not.toThrow(
        /session-(?:old|new)-sentinel/u,
      );
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('keeps the stable session and configured values behind the execution boundary', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: 'session-sentinel' }),
      ],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [
        {
          ...jsonRpcResult(1, { tools: [tool('lookup')] }),
          headers: { 'mcp-session-id': 'session-sentinel' },
        },
      ],
      'tools/call': [
        jsonRpcResult(2, {
          content: [
            {
              type: 'text',
              text: 'AUTH-SENTINEL session-sentinel session-sentinel',
            },
          ],
          structuredContent: {
            safe: 'kept',
            typed: [123, true, null],
          },
        }),
        jsonRpcResult(3, {
          content: [{ type: 'text', text: 'unsafe key' }],
          structuredContent: {
            'session-sentinel-key': 'must not escape',
          },
        }),
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 4,
            error: {
              code: -32_000,
              message: 'AUTH-SENTINEL',
              data: { hint: 'AUTH-SENTINEL' },
            },
          },
        },
        jsonRpcResult(5, {
          content: [{ type: 'text', text: 'AUTH-SENTINEL' }],
          isError: true,
        }),
        jsonRpcResult(6, {
          content: [{ type: 'text', text: 'unsafe error' }],
          structuredContent: {
            'session-sentinel-key': 'must not escape',
          },
          isError: true,
        }),
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 7,
            error: {
              code: -32_000,
              message: 'remote error',
              data: { 'session-sentinel-key': 'must not escape' },
            },
          },
        },
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
      headers: {
        authorization: 'AUTH-SENTINEL',
        'x-number': '123',
        'x-boolean': 'true',
        'x-null': 'null',
      },
    });

    try {
      const catalog = await client.discover();
      const execute = byId(catalog.tools, 'mcp__web__lookup').execute;
      const options = {
        toolCallId: 'call',
        messages: [],
        abortSignal: undefined,
      };

      const rejectedArgument = await execute(
        { query: 'AUTH-SENTINEL' },
        options,
      );
      expect(rejectedArgument).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'invalid_input',
          message: 'MCP tool arguments contain a protected value.',
        },
      });
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
      ).toHaveLength(0);

      const safe = await execute({ query: 'safe' }, options);
      expect(safe).toEqual({
        disposition: 'none',
        result: {
          status: 'success',
          output: {
            content: [
              {
                type: 'text',
                text: '[REDACTED] [REDACTED] [REDACTED]',
              },
            ],
            structuredContent: {
              safe: 'kept',
              typed: ['[REDACTED]', '[REDACTED]', '[REDACTED]'],
            },
            isError: false,
          },
        },
      });
      expect(JSON.stringify(safe)).not.toMatch(
        /AUTH-SENTINEL|session-sentinel/u,
      );

      const unsafeKey = await execute({ query: 'safe' }, options);
      expect(unsafeKey).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'execution_failed',
          message: 'The remote tool returned an unsafe result.',
        },
      });
      expect(JSON.stringify(unsafeKey)).not.toContain('session-sentinel');

      const toolError = await execute({ query: 'safe' }, options);
      expect(toolError).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'remote_error',
          message: 'The remote tool reported an error.',
        },
      });
      expect(JSON.stringify(toolError)).not.toContain('AUTH-SENTINEL');

      const isError = await execute({ query: 'safe' }, options);
      expect(isError).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'remote_error',
          message: 'The remote tool reported an error.',
        },
      });
      expect(JSON.stringify(isError)).not.toContain('AUTH-SENTINEL');

      const unsafeIsError = await execute({ query: 'safe' }, options);
      expect(unsafeIsError).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'execution_failed',
          message: 'The remote tool returned an unsafe result.',
        },
      });
      expect(JSON.stringify(unsafeIsError)).not.toContain('session-sentinel');

      const unsafeErrorData = await execute({ query: 'safe' }, options);
      expect(unsafeErrorData).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'execution_failed',
          message: 'The remote tool failed to execute.',
        },
      });
      expect(JSON.stringify(unsafeErrorData)).not.toContain('session-sentinel');
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('protects both configured and wire-normalized header values', async () => {
    const rawHeader = '  Bearer secret  ';
    const normalizedHeader = 'Bearer secret';
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [
        jsonRpcResult(1, {
          tools: [
            tool(normalizedHeader),
            tool('lookup', {
              description: `${rawHeader} / ${normalizedHeader}`,
            }),
          ],
        }),
      ],
      'tools/call': [
        jsonRpcResult(2, {
          content: [
            { type: 'text', text: `${rawHeader} / ${normalizedHeader}` },
          ],
        }),
      ],
      $delete: [{ kind: 'raw', status: 204, body: '' }],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
      headers: { authorization: rawHeader },
    });

    try {
      expect(
        fixture.receivedHeaderMatching(
          ({ rpcMethod }) => rpcMethod === 'initialize',
          'authorization',
          normalizedHeader,
        ),
      ).toBe(true);

      const catalog = await client.discover();
      expect(catalog.refused).toContainEqual({
        index: 0,
        reason: 'protected_value',
      });
      expect(catalog.tools).toHaveLength(1);
      expect(catalog.tools[0]?.definition.description).toBe(
        '[REDACTED] / [REDACTED]',
      );

      const outcome = await byId(catalog.tools, 'mcp__web__lookup').execute(
        {},
        { toolCallId: 'call', messages: [], abortSignal: undefined },
      );
      expect(outcome).toMatchObject({
        result: {
          status: 'success',
          output: {
            content: [{ type: 'text', text: '[REDACTED] / [REDACTED]' }],
          },
        },
      });
      expect(JSON.stringify({ catalog, outcome })).not.toContain(rawHeader);
      expect(JSON.stringify({ catalog, outcome })).not.toContain(
        normalizedHeader,
      );
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('keeps invalid header failures behind the safe initialization boundary', async () => {
    const invalidHeader = 'AUTH-SENTINEL\r\nx-leak: yes';

    const connection = McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      headers: { authorization: invalidHeader },
      fetch: vi.fn(),
    });

    await expect(connection).rejects.toMatchObject({
      name: 'McpServerOperationError',
      stage: 'initialize',
    } satisfies Partial<McpServerOperationError>);
    await expect(connection).rejects.not.toThrow(/AUTH-SENTINEL|x-leak/u);
  });

  it('classifies call HTTP status from trusted structure and never retries', async () => {
    const statuses = [401, 403, 404, 410, 429, 500] as const;
    const { fixture, client } = await connectFixture({
      listResponses: [jsonRpcResult(1, { tools: [tool('lookup')] })],
      callResponses: statuses.map((status) => ({
        kind: 'raw' as const,
        status,
        contentType: 'application/json',
        body: 'AUTH-SENTINEL remote prose must not classify or escape',
      })),
    });

    try {
      const catalog = await client.discover();
      const execute = byId(catalog.tools, 'mcp__web__lookup').execute;
      const outcomes: Array<McpCallOutcome> = [];
      for (const status of statuses) {
        outcomes.push(
          await execute(
            { status },
            {
              toolCallId: `call-${status}`,
              messages: [],
              abortSignal: undefined,
            },
          ),
        );
      }

      expect(outcomes.map(({ disposition }) => disposition)).toEqual([
        'reconnect',
        'reconnect',
        'reconnect',
        'call_local',
        'call_local',
        'call_local',
      ]);
      expect(outcomes.map(({ result }) => result)).toEqual(
        statuses.map(() => ({
          status: 'error',
          type: 'execution_failed',
          message: 'The remote tool failed to execute.',
        })),
      );
      expect(JSON.stringify(outcomes)).not.toContain('AUTH-SENTINEL');
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
      ).toHaveLength(statuses.length);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it.each([410, 429, 500] as const)(
    'does not let a concurrent call-local HTTP %s abort discovery',
    async (status) => {
      const { fixture, client } = await connectFixture({
        listResponses: [
          jsonRpcResult(1, { tools: [tool('lookup')] }),
          {
            ...jsonRpcResult(2, { tools: [tool('lookup')] }),
            delayMs: 100,
          },
        ],
        callResponses: [
          {
            kind: 'raw',
            status,
            contentType: 'application/json',
            body: 'call-local failure',
          },
        ],
      });

      try {
        const initialCatalog = await client.discover();
        const refresh = client.discover();
        await vi.waitFor(() => {
          expect(
            fixture
              .requestSummaries()
              .filter(({ rpcMethod }) => rpcMethod === 'tools/list'),
          ).toHaveLength(2);
        });
        const call = await byId(
          initialCatalog.tools,
          'mcp__web__lookup',
        ).execute(
          {},
          { toolCallId: 'call', messages: [], abortSignal: undefined },
        );

        expect(call.disposition).toBe('call_local');
        const refreshedCatalog = await refresh;
        expect(
          refreshedCatalog.tools.map(({ definition }) => definition.remoteName),
        ).toEqual(['lookup']);
      } finally {
        await cleanup({ client, fixture });
      }
    },
  );

  it('does not let one failed call settle an unrelated sibling call', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [jsonRpcResult(1, { tools: [tool('lookup')] })],
      callResponses: [
        {
          ...jsonRpcResult(2, { content: [{ type: 'text', text: 'slow' }] }),
          delayMs: 100,
        },
        {
          kind: 'raw',
          status: 500,
          contentType: 'application/json',
          body: 'sibling failure',
        },
      ],
    });

    try {
      const catalog = await client.discover();
      const execute = byId(catalog.tools, 'mcp__web__lookup').execute;
      const slowCall = execute(
        { call: 'slow' },
        { toolCallId: 'slow', messages: [], abortSignal: undefined },
      );
      await vi.waitFor(() => {
        expect(
          fixture
            .requestSummaries()
            .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
        ).toHaveLength(1);
      });
      const failedCall = await execute(
        { call: 'failure' },
        { toolCallId: 'failure', messages: [], abortSignal: undefined },
      );

      expect(failedCall.disposition).toBe('call_local');
      await expect(slowCall).resolves.toMatchObject({
        disposition: 'none',
        result: { status: 'success' },
      });
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('classifies trusted failures through package wrappers before generic JSON-RPC codes', async () => {
    const zodError = Object.assign(new Error('schema details'), {
      name: 'ZodError',
    });
    const failures = [
      Object.assign(new Error('outer'), {
        code: -32_000,
        cause: new McpBodyLimitError(ONE_MIB),
      }),
      Object.assign(new Error('outer'), {
        code: -32_000,
        cause: new McpRequestLimitError(),
      }),
      Object.assign(new Error('outer'), {
        code: -32_000,
        cause: Object.assign(new Error('HTTP details'), { statusCode: 401 }),
      }),
      Object.assign(new Error('outer'), {
        code: -32_000,
        cause: Object.assign(new Error('parse details'), {
          name: 'MCPClientError',
          cause: zodError,
        }),
      }),
      Object.assign(new Error('remote tool error'), { code: -32_000 }),
    ];
    let callIndex = 0;
    const fetchStub = vi.fn(
      (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return resolvedResponse(new Response('', { status: 405 }));
        }
        if (init?.method === 'DELETE') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return resolvedResponse(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  protocolVersion: '2025-11-25',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'fixture', version: '1.0.0' },
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (request.method === 'notifications/initialized') {
          return resolvedResponse(new Response(null, { status: 204 }));
        }
        if (request.method === 'tools/list') {
          return resolvedResponse(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: request.id,
                result: { tools: [tool('lookup')] },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (request.method === 'tools/call') {
          const failure = failures[callIndex];
          callIndex += 1;
          return Promise.reject(failure);
        }
        throw new Error('unexpected request');
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
    });

    try {
      const catalog = await client.discover();
      const execute = byId(catalog.tools, 'mcp__web__lookup').execute;
      const outcomes: Array<McpCallOutcome> = [];
      for (let index = 0; index < failures.length; index += 1) {
        outcomes.push(
          await execute(
            {},
            {
              toolCallId: `call-${index}`,
              messages: [],
              abortSignal: undefined,
            },
          ),
        );
      }

      expect(outcomes.map(({ disposition }) => disposition)).toEqual([
        'reconnect',
        'reconnect',
        'reconnect',
        'call_local',
        'call_local',
      ]);
      expect(outcomes.map(({ result }) => result.type)).toEqual([
        'execution_failed',
        'execution_failed',
        'execution_failed',
        'execution_failed',
        'remote_error',
      ]);
      expect(callIndex).toBe(failures.length);
    } finally {
      await client.close();
    }
  });

  it('keeps a sessionless 404 call-local', async () => {
    const fixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [mcpStreamableHttpInitialize()],
      'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
      'tools/list': [jsonRpcResult(1, { tools: [tool('lookup')] })],
      'tools/call': [
        {
          kind: 'raw',
          status: 404,
          contentType: 'application/json',
          body: 'not found',
        },
      ],
    });
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: fixture.url,
    });

    try {
      const catalog = await client.discover();
      const outcome = await byId(catalog.tools, 'mcp__web__lookup').execute(
        {},
        { toolCallId: 'call', messages: [], abortSignal: undefined },
      );
      expect(outcome.disposition).toBe('call_local');
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('bounds request and response failures without retrying or leaking partial results', async () => {
    const oversizedSseMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      result: {
        content: [{ type: 'text', text: 'x'.repeat(ONE_MIB + 1) }],
      },
    });
    const { fixture, client } = await connectFixture({
      listResponses: [jsonRpcResult(1, { tools: [tool('lookup')] })],
      callResponses: [
        {
          kind: 'raw',
          status: 500,
          contentType: 'application/json',
          body: 'first failure',
        },
        {
          kind: 'raw',
          status: 503,
          contentType: 'application/json',
          body: 'x'.repeat(ONE_MIB + 1),
        },
        {
          kind: 'sse',
          events: [{ data: oversizedSseMessage, rawData: true }],
        },
        jsonRpcResult(6, { content: 'not-an-array' }),
        { kind: 'disconnect' },
      ],
    });

    try {
      const catalog = await client.discover();
      const execute = byId(catalog.tools, 'mcp__web__lookup').execute;
      const options = {
        toolCallId: 'call',
        messages: [],
        abortSignal: undefined,
      };

      const remote500 = await execute({}, options);
      expect(remote500.disposition).toBe('call_local');
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
      ).toHaveLength(1);

      const oversizedInput = await execute(
        { query: 'q'.repeat(ONE_MIB) },
        options,
      );
      expect(oversizedInput.disposition).toBe('reconnect');
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
      ).toHaveLength(1);

      const oversizedErrorBody = await execute({}, options);
      const oversizedSse = await execute({}, options);
      const invalidOutput = await execute({}, options);
      const disconnected = await execute({}, options);

      expect([
        oversizedErrorBody.disposition,
        oversizedSse.disposition,
        invalidOutput.disposition,
        disconnected.disposition,
      ]).toEqual(['reconnect', 'reconnect', 'call_local', 'reconnect']);
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
      ).toHaveLength(5);
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('keeps caller cancellation and timeout call-local while aborting the request', async () => {
    const { fixture, client } = await connectFixture({
      listResponses: [jsonRpcResult(1, { tools: [tool('lookup')] })],
      callResponses: [
        { ...jsonRpcResult(2, { content: [] }), delayMs: 100 },
        { ...jsonRpcResult(3, { content: [] }), delayMs: 100 },
      ],
    });

    try {
      const catalog = await client.discover();
      const execute = byId(catalog.tools, 'mcp__web__lookup').execute;
      const controller = new AbortController();
      const cancelledPromise = execute(
        {},
        { toolCallId: 'cancel', messages: [], abortSignal: controller.signal },
      );
      await vi.waitFor(() => {
        expect(
          fixture
            .requestSummaries()
            .filter(({ rpcMethod }) => rpcMethod === 'tools/call'),
        ).toHaveLength(1);
      });
      controller.abort(new Error('caller detail'));
      await expect(cancelledPromise).resolves.toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'cancelled',
          message: 'The remote tool call was cancelled.',
        },
      });

      const timeoutSignal = AbortSignal.timeout(10);
      const timedOut = await execute(
        {},
        { toolCallId: 'timeout', messages: [], abortSignal: timeoutSignal },
      );
      expect(timedOut).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'timeout',
          message: 'The remote tool call timed out.',
        },
      });
    } finally {
      await cleanup({ client, fixture });
    }
  });

  it('closes once and settles within the fixed shutdown bound', async () => {
    let deleteRequests = 0;
    let deleteAborted = false;
    const fetchStub = vi.fn(
      async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response('', { status: 405 });
        }
        if (init?.method === 'DELETE') {
          deleteRequests += 1;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                deleteAborted = true;
                reject(new Error('delete aborted'));
              },
              { once: true },
            );
          });
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'fixture', version: '1.0.0' },
              },
            }),
            {
              headers: {
                'content-type': 'application/json',
                'mcp-session-id': 'session-sentinel',
              },
            },
          );
        }
        return new Response(null, { status: 204 });
      },
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
    });
    vi.useFakeTimers();

    try {
      const first = client.close();
      const second = client.close();
      expect(second).toBe(first);
      const observed = Promise.race([
        first.then(() => 'closed' as const),
        new Promise<'missed-bound'>((resolve) =>
          setTimeout(() => resolve('missed-bound'), 5100),
        ),
      ]);
      await vi.advanceTimersByTimeAsync(5100);
      await expect(observed).resolves.toBe('closed');
      expect(deleteRequests).toBe(1);
      expect(deleteAborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts initialization at 30 seconds and exposes only a closed safe failure', async () => {
    let initializeAborted = false;
    const fetchStub = vi.fn(
      async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response('', { status: 405 });
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                initializeAborted = true;
                reject(new Error('request aborted'));
              },
              { once: true },
            );
          });
        }
        return new Response(null, { status: 204 });
      },
    );
    vi.useFakeTimers();
    const connect = McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      headers: { authorization: 'AUTH-SENTINEL' },
      fetch: fetchStub,
    });
    const observed = Promise.race([
      connect,
      new Promise<'missed-deadline'>((resolve) =>
        setTimeout(() => resolve('missed-deadline'), 31_000),
      ),
    ]);

    try {
      const rejection = observed.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(31_000);
      await expect(rejection).resolves.toMatchObject({
        name: 'McpServerOperationError',
        stage: 'initialize',
        kind: 'timeout',
        disposition: 'reconnect',
      } satisfies Partial<McpServerOperationError>);
      expect(initializeAborted).toBe(true);
      await expect(connect).rejects.not.toThrow('AUTH-SENTINEL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a pre-aborted initialization signal closed without starting transport work', async () => {
    const controller = new AbortController();
    controller.abort(new Error('AUTH-SENTINEL pre-abort reason'));
    const fetchStub = vi.fn<typeof fetch>();
    const connection = McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
      signal: controller.signal,
    });

    await expect(connection).rejects.toMatchObject({
      name: 'McpServerOperationError',
      stage: 'initialize',
      kind: 'cancelled',
      disposition: 'reconnect',
    } satisfies Partial<McpServerOperationError>);
    await expect(connection).rejects.not.toThrow('AUTH-SENTINEL');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('aborts in-flight initialization from the external signal without leaking its reason', async () => {
    let initializeAborted = false;
    const fetchStub = vi.fn(
      async (_request: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response('', { status: 405 });
        }
        const request = requestBody(init);
        if (request.method === 'initialize') {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                initializeAborted = true;
                reject(new Error('underlying request aborted'));
              },
              { once: true },
            );
          });
        }
        return new Response(null, { status: 204 });
      },
    );
    const controller = new AbortController();
    const connection = McpServerClient.connect({
      serverId: 'web',
      url: 'https://fixture.invalid/mcp',
      fetch: fetchStub,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(
        fetchStub.mock.calls.some(
          ([, init]) =>
            hasStringInitBody(init) &&
            requestBody(init).method === 'initialize',
        ),
      ).toBe(true);
    });
    controller.abort(new Error('AUTH-SENTINEL shutdown reason'));

    await expect(connection).rejects.toMatchObject({
      name: 'McpServerOperationError',
      stage: 'initialize',
      kind: 'cancelled',
      disposition: 'reconnect',
    } satisfies Partial<McpServerOperationError>);
    expect(initializeAborted).toBe(true);
    await expect(connection).rejects.not.toThrow('AUTH-SENTINEL');
  });

  it.each([
    {
      name: 'HTTP failure',
      response: {
        kind: 'raw',
        status: 500,
        body: 'AUTH-SENTINEL must not escape',
      } satisfies McpFixtureResponse,
      kind: 'http',
    },
    {
      name: 'malformed JSON',
      response: {
        kind: 'raw',
        body: '{"secret":"AUTH-SENTINEL"',
        contentType: 'application/json',
      } satisfies McpFixtureResponse,
      kind: 'malformed_protocol',
    },
  ] as const)(
    'closes $name discovery failures behind the classified control-plane boundary',
    async ({ response, kind }) => {
      const { fixture, client } = await connectFixture({
        listResponses: [response],
      });

      try {
        const discovery = client.discover();
        await expect(discovery).rejects.toMatchObject({
          name: 'McpServerOperationError',
          stage: 'discovery',
          kind,
          disposition: 'reconnect',
        } satisfies Partial<McpServerOperationError>);
        await expect(discovery).rejects.not.toThrow('AUTH-SENTINEL');
      } finally {
        await cleanup({ client, fixture });
      }
    },
  );
});
