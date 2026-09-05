import { describe, expect, it, vi } from 'vitest';

import {
  McpServerOperationError,
  McpServerClient,
  type McpDiscoveredTool,
} from './mcp-server-client';
import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

/**
 * Transport-level protocol behaviour driven by a `fetch` double rather than the
 * loopback fixture: every assertion here is about the bytes this client sends
 * and the bytes it accepts back, so a hand-written response body is the seam.
 */

const textEncoder = new TextEncoder();
const emptySchema = { type: 'object' as const, properties: {} };
const executeOptions = {
  toolCallId: 'call',
  messages: [],
  abortSignal: undefined,
};

type RequestId = number | string | undefined;

type StubRequest = {
  readonly key: string;
  readonly id: RequestId;
  readonly body: UnknownRecord | null;
};

type StubHandler = (request: StubRequest) => Response;

type StubScript = Readonly<Record<string, ReadonlyArray<StubHandler>>>;

function parseBody(body: BodyInit | null | undefined): UnknownRecord | null {
  if (!isString(body)) return null;
  try {
    // SAFETY: JSON.parse returns any; asserting unknown forces isRecord's
    // check below rather than silently inheriting any.
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function requestId(body: UnknownRecord | null): RequestId {
  const id = body?.['id'];
  if (isString(id) || isNumber(id)) return id;
  return undefined;
}

function raw(status: number, body: string, contentType?: string): StubHandler {
  return () =>
    new Response(body.length === 0 ? null : body, {
      status,
      ...(contentType !== undefined && {
        headers: { 'content-type': contentType },
      }),
    });
}

function jsonRpc(
  result: UnknownRecord,
  headers: Readonly<Record<string, string>> = {},
): StubHandler {
  return ({ id }) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      headers: { 'content-type': 'application/json', ...headers },
    });
}

function jsonRpcError(code: number, message: string): StubHandler {
  return ({ id }) =>
    new Response(
      JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
}

function sseFrames(build: (id: RequestId) => string): StubHandler {
  return ({ id }) =>
    new Response(build(id), {
      headers: { 'content-type': 'text/event-stream' },
    });
}

function initializeResult(protocolVersion = '2025-11-25'): UnknownRecord {
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: 'stub', version: '1.0.0' },
  };
}

function declaration(
  name: string,
  description = `Use ${name}.`,
): UnknownRecord {
  return { name, description, inputSchema: emptySchema };
}

function createStubTransport(script: StubScript) {
  const queues = new Map(
    Object.entries(script).map(([key, handlers]) => [key, [...handlers]]),
  );
  const requests: Array<StubRequest> = [];
  const fetchStub = (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const httpMethod = (init?.method ?? 'GET').toUpperCase();
    const body = parseBody(init?.body);
    const rpcMethod = body?.['method'];
    const key = isString(rpcMethod)
      ? rpcMethod
      : `$${httpMethod.toLowerCase()}`;
    const request: StubRequest = { key, id: requestId(body), body };
    requests.push(request);
    // The last scripted response for a key repeats: a transport may re-open
    // its inbound GET, and an unscripted 500 there would look like a drop.
    const queue = queues.get(key);
    const handler =
      queue === undefined || queue.length === 0
        ? undefined
        : queue.length === 1
          ? queue[0]
          : queue.shift();
    if (handler === undefined) {
      return Promise.resolve(new Response('unscripted', { status: 500 }));
    }
    return Promise.resolve(handler(request));
  };
  return { fetchStub, requests };
}

function scriptWithDefaults(overrides: StubScript) {
  return {
    $get: [raw(405, '')],
    initialize: [jsonRpc(initializeResult())],
    'notifications/initialized': [raw(202, '')],
    $delete: [raw(204, '')],
    ...overrides,
  };
}

async function connectStub(
  overrides: StubScript,
  config: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly onDisconnect?: () => void;
  } = {},
) {
  const transport = createStubTransport(scriptWithDefaults(overrides));
  const client = await McpServerClient.connect({
    serverId: 'web',
    url: 'https://mcp.test/mcp',
    fetch: transport.fetchStub,
    ...config,
  });
  return { ...transport, client };
}

function toolIds(tools: ReadonlyArray<McpDiscoveredTool>): Array<string> {
  return tools.map(({ definition }) => definition.id);
}

function nestedArrayLeaf(depth: number): Array<unknown> | { type: string } {
  return depth === 0 ? { type: 'string' } : [nestedArrayLeaf(depth - 1)];
}

function nestedArraySchema(depth: number) {
  return {
    type: 'object',
    properties: { deep: { enum: nestedArrayLeaf(depth) } },
  };
}

function names(count: number, offset = 0): Array<UnknownRecord> {
  return Array.from({ length: count }, (_value, index) =>
    declaration(`t${String(index + offset).padStart(4, '0')}`),
  );
}

describe('McpServerClient transport protocol', () => {
  it('pages a catalog without a cursor parameter and returns it in id order', async () => {
    const { client, requests } = await connectStub({
      'tools/list': [
        jsonRpc({
          tools: [declaration('zeta'), declaration('alpha')],
          nextCursor: 'page-2',
        }),
        jsonRpc({ tools: [declaration('mike'), declaration('bravo')] }),
      ],
    });

    try {
      const catalog = await client.discover();
      expect(toolIds(catalog.tools)).toEqual([
        'mcp__web__alpha',
        'mcp__web__bravo',
        'mcp__web__mike',
        'mcp__web__zeta',
      ]);
      const listRequests = requests.filter(({ key }) => key === 'tools/list');
      expect(listRequests.map(({ body }) => body?.['params'])).toEqual([
        undefined,
        { cursor: 'page-2' },
      ]);
    } finally {
      await client.close();
    }
  });

  it('reports refusals in original declaration order across admission phases', async () => {
    const oversized = declaration('bulky', 'x'.repeat(300 * 1024));
    const { client } = await connectStub({
      'tools/list': [jsonRpc({ tools: [declaration('***'), oversized] })],
    });

    try {
      const catalog = await client.discover();
      expect(catalog.tools).toEqual([]);
      expect(catalog.refused.map(({ index }) => index)).toEqual([0, 1]);
      expect(catalog.refused.map(({ reason }) => reason)).toEqual([
        'invalid_tool_id',
        'declaration_too_large',
      ]);
      expect(
        catalog.refused.map((entry) => Object.hasOwn(entry, 'id')),
      ).toEqual([false, true]);
    } finally {
      await client.close();
    }
  });

  it('omits every refusal id that would echo a configured header value', async () => {
    const secret = 'Bearer sentinel-credential';
    const { client } = await connectStub(
      {
        'tools/list': [
          jsonRpc({
            tools: [
              declaration(`${secret} large`, 'y'.repeat(300 * 1024)),
              {
                name: `${secret} deep`,
                description: 'Deep.',
                inputSchema: nestedArraySchema(70),
              },
            ],
          }),
        ],
      },
      { headers: { authorization: secret } },
    );

    try {
      const catalog = await client.discover();
      expect(catalog.refused.map(({ reason }) => reason)).toEqual([
        'declaration_too_large',
        'schema_too_deep',
      ]);
      expect(
        catalog.refused.map((entry) => Object.hasOwn(entry, 'id')),
      ).toEqual([false, false]);
      expect(JSON.stringify(catalog.refused)).not.toContain('sentinel');
    } finally {
      await client.close();
    }
  });

  it('admits a full page of 256 declarations and a 1,000-tool catalog', async () => {
    const { client } = await connectStub({
      'tools/list': [
        jsonRpc({ tools: names(256), nextCursor: 'p2' }),
        jsonRpc({ tools: names(256, 256), nextCursor: 'p3' }),
        jsonRpc({ tools: names(256, 512), nextCursor: 'p4' }),
        jsonRpc({ tools: names(232, 768) }),
      ],
    });

    try {
      const catalog = await client.discover();
      expect(catalog.tools).toHaveLength(1000);
      expect(catalog.refused).toEqual([]);
    } finally {
      await client.close();
    }
    // Four pages of 256 declarations exercise the catalog cap for real, which
    // costs more than the 5s default this suite runs under outside Stryker.
  }, 30_000);

  it('refuses a schema nested past depth 64 through array branches', async () => {
    const { client } = await connectStub({
      'tools/list': [
        jsonRpc({
          tools: [
            {
              name: 'deep',
              description: 'Deep.',
              inputSchema: nestedArraySchema(70),
            },
            declaration('shallow'),
          ],
        }),
      ],
    });

    try {
      const catalog = await client.discover();
      expect(toolIds(catalog.tools)).toEqual(['mcp__web__shallow']);
      expect(catalog.refused).toEqual([
        { index: 0, reason: 'schema_too_deep', id: 'mcp__web__deep' },
      ]);
    } finally {
      await client.close();
    }
  });

  it.each([
    [
      'a bare event field with no value',
      (id: RequestId) =>
        `event\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })}\n\n`,
    ],
    [
      'an explicit message event type',
      (id: RequestId) =>
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })}\n\n`,
    ],
    [
      'a data field with no leading space and a trailing space',
      (id: RequestId) =>
        `data:${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })} \n\n`,
    ],
    [
      'an earlier event that carries no data field',
      (id: RequestId) =>
        `event: message\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })}\n\n`,
    ],
  ] satisfies ReadonlyArray<[string, (id: RequestId) => string]>)(
    'accepts a POST-SSE initialize framed with %s',
    async (_name, build) => {
      const { client } = await connectStub({
        initialize: [sseFrames(build)],
        'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
      });

      try {
        const catalog = await client.discover();
        expect(toolIds(catalog.tools)).toEqual(['mcp__web__lookup']);
      } finally {
        await client.close();
      }
    },
  );

  it.each([
    [
      'a data field with no colon',
      (id: RequestId) =>
        `data\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })}\n\n`,
    ],
    [
      'a data field with an empty value',
      (id: RequestId) =>
        `data:\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })}\n\n`,
    ],
    [
      'data fields that only join into JSON without their separator',
      (id: RequestId) =>
        `data: [1\ndata: 2]\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: initializeResult() })}\n\n`,
    ],
    [
      'a response id that never matches the request',
      () =>
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: 'unmatched', result: initializeResult() })}\n\n`,
    ],
  ] satisfies ReadonlyArray<[string, (id: RequestId) => string]>)(
    'refuses a POST-SSE initialize whose earlier frame carries %s',
    async (_name, build) => {
      const transport = createStubTransport(
        scriptWithDefaults({ initialize: [sseFrames(build)] }),
      );

      await expect(
        McpServerClient.connect({
          serverId: 'web',
          url: 'https://mcp.test/mcp',
          fetch: transport.fetchStub,
        }),
      ).rejects.toMatchObject({
        name: 'McpServerOperationError',
        stage: 'initialize',
        kind: 'malformed_protocol',
      });
    },
  );

  it('accepts a batched initialize response beside an id-matching decoy', async () => {
    const { client } = await connectStub({
      initialize: [
        ({ id }) =>
          new Response(
            JSON.stringify([
              { jsonrpc: '2.0', id },
              { jsonrpc: '2.0', id, result: initializeResult() },
            ]),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
    });

    try {
      const catalog = await client.discover();
      expect(toolIds(catalog.tools)).toEqual(['mcp__web__lookup']);
    } finally {
      await client.close();
    }
  });

  it.each([
    ['JSON', (result: UnknownRecord) => jsonRpc(result)],
    [
      'POST SSE',
      (result: UnknownRecord) =>
        sseFrames(
          (id) => `data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`,
        ),
    ],
  ] satisfies ReadonlyArray<[string, (result: UnknownRecord) => StubHandler]>)(
    'gates the negotiated revision on initialize only, not on a %s discovery page',
    async (_name, respond) => {
      const { client } = await connectStub({
        'tools/list': [
          respond({
            tools: [declaration('lookup')],
            protocolVersion: '2024-11-05',
          }),
        ],
      });

      try {
        const catalog = await client.discover();
        expect(toolIds(catalog.tools)).toEqual(['mcp__web__lookup']);
      } finally {
        await client.close();
      }
    },
  );

  it('monitors an inbound GET stream advertised with an upper-case media type', async () => {
    const onDisconnect = vi.fn();
    let inbound: ReadableStreamDefaultController<Uint8Array> | undefined;
    const { client } = await connectStub(
      {
        $get: [
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  inbound = controller;
                  controller.enqueue(textEncoder.encode(': open\n\n'));
                },
              }),
              { headers: { 'content-type': 'TEXT/EVENT-STREAM' } },
            ),
        ],
        'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
      },
      { onDisconnect },
    );

    try {
      const catalog = await client.discover();
      expect(toolIds(catalog.tools)).toEqual(['mcp__web__lookup']);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onDisconnect).not.toHaveBeenCalled();
    } finally {
      inbound?.close();
      await client.close();
    }
  });

  it('reports an open inbound GET stream that is not an event stream', async () => {
    const onDisconnect = vi.fn();
    let inbound: ReadableStreamDefaultController<Uint8Array> | undefined;
    const { client } = await connectStub(
      {
        $get: [
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  inbound = controller;
                  controller.enqueue(textEncoder.encode('{}'));
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        ],
      },
      { onDisconnect },
    );

    try {
      await vi.waitFor(() => {
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
    } finally {
      inbound?.close();
      await client.close();
    }
  });

  it('reports an inbound GET stream that fails while being read', async () => {
    const onDisconnect = vi.fn();
    const { client } = await connectStub(
      {
        $get: [
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(textEncoder.encode(': open\n\n'));
                },
                pull(controller) {
                  controller.error(new Error('inbound stream failed'));
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } },
            ),
        ],
      },
      { onDisconnect },
    );

    try {
      await vi.waitFor(() => {
        expect(onDisconnect).toHaveBeenCalledTimes(1);
      });
    } finally {
      await client.close();
    }
  });

  it('keeps a request-scoped transport rejection out of the disconnect callback', async () => {
    const onDisconnect = vi.fn();
    const transport = createStubTransport(scriptWithDefaults({}));
    const failingFetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = parseBody(init?.body);
      if (body?.['method'] === 'tools/list') {
        return Promise.reject(new Error('socket closed'));
      }
      return transport.fetchStub(input, init);
    };
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://mcp.test/mcp',
      fetch: failingFetch,
      onDisconnect,
    });

    try {
      await expect(client.discover()).rejects.toBeInstanceOf(
        McpServerOperationError,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onDisconnect).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('keeps a mid-session id change out of the disconnect callback', async () => {
    const onDisconnect = vi.fn();
    const transport = createStubTransport(
      scriptWithDefaults({
        initialize: [
          jsonRpc(initializeResult(), { 'mcp-session-id': 'first' }),
        ],
        'tools/list': [
          jsonRpc(
            { tools: [declaration('lookup')] },
            { 'mcp-session-id': 'second' },
          ),
        ],
      }),
    );
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://mcp.test/mcp',
      fetch: transport.fetchStub,
      onDisconnect,
    });

    try {
      await expect(client.discover()).rejects.toMatchObject({
        name: 'McpServerOperationError',
        stage: 'discovery',
        kind: 'malformed_protocol',
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onDisconnect).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('treats an empty session id header as no session at all', async () => {
    const { client } = await connectStub({
      initialize: [jsonRpc(initializeResult(), { 'mcp-session-id': '' })],
      'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
      'tools/call': [raw(404, 'gone', 'text/plain')],
    });

    try {
      const catalog = await client.discover();
      const [discovered] = catalog.tools;
      expect(discovered).toBeDefined();
      const outcome = await discovered?.execute({ query: 'x' }, executeOptions);
      expect(outcome).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'execution_failed',
          message: 'The remote tool failed to execute.',
        },
      });
    } finally {
      await client.close();
    }
  });

  it('protects nothing beyond configuration when the server issues no session', async () => {
    const { client } = await connectStub({
      'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
      'tools/call': [
        jsonRpc({ content: [{ type: 'text', text: 'Stryker was here' }] }),
      ],
    });

    try {
      const catalog = await client.discover();
      const [discovered] = catalog.tools;
      const outcome = await discovered?.execute({ query: 'x' }, executeOptions);
      expect(outcome).toEqual({
        disposition: 'none',
        result: {
          status: 'success',
          output: {
            content: [{ type: 'text', text: 'Stryker was here' }],
            isError: false,
          },
        },
      });
    } finally {
      await client.close();
    }
  });

  it('accepts a portable result carried as toolResult without content', async () => {
    const { client } = await connectStub({
      'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
      'tools/call': [jsonRpc({ toolResult: { ok: true } })],
    });

    try {
      const catalog = await client.discover();
      const [discovered] = catalog.tools;
      const outcome = await discovered?.execute({ query: 'x' }, executeOptions);
      expect(outcome).toEqual({
        disposition: 'none',
        result: { status: 'success', output: { toolResult: { ok: true } } },
      });
    } finally {
      await client.close();
    }
  });

  it.each([
    ['a JSON-RPC error code', jsonRpcError(-32_000, 'server refused')],
    ['a schema-invalid payload', jsonRpc({ tools: 'not-an-array' })],
  ] satisfies ReadonlyArray<[string, StubHandler]>)(
    'classifies %s during discovery as malformed protocol',
    async (_name, respond) => {
      const { client } = await connectStub({ 'tools/list': [respond] });

      try {
        await expect(client.discover()).rejects.toMatchObject({
          name: 'McpServerOperationError',
          stage: 'discovery',
          kind: 'malformed_protocol',
          disposition: 'reconnect',
        });
      } finally {
        await client.close();
      }
    },
  );

  it('accepts a CRLF POST-SSE initialize split across two data fields', async () => {
    const { client } = await connectStub({
      initialize: [
        sseFrames((id) => {
          const head = `{"jsonrpc":"2.0","id":${JSON.stringify(id)},`;
          const tail = `"result":${JSON.stringify(initializeResult())}}`;
          return `data: ${head}\r\ndata: ${tail}\r\n\r\n`;
        }),
      ],
      'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
    });

    try {
      const catalog = await client.discover();
      expect(toolIds(catalog.tools)).toEqual(['mcp__web__lookup']);
    } finally {
      await client.close();
    }
  });

  it('reports an inbound GET whose transport rejects before any response', async () => {
    const onDisconnect = vi.fn();
    const transport = createStubTransport(scriptWithDefaults({}));
    const failingGet = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      (init?.method ?? 'GET').toUpperCase() === 'GET'
        ? Promise.reject(new Error('inbound socket refused'))
        : transport.fetchStub(input, init);
    const client = await McpServerClient.connect({
      serverId: 'web',
      url: 'https://mcp.test/mcp',
      fetch: failingGet,
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

  it('reports a remote tool error distinctly from a transport failure', async () => {
    const { client } = await connectStub({
      'tools/list': [jsonRpc({ tools: [declaration('lookup')] })],
      'tools/call': [jsonRpcError(-32_000, 'the tool refused')],
    });

    try {
      const catalog = await client.discover();
      const [discovered] = catalog.tools;
      const outcome = await discovered?.execute({ query: 'x' }, executeOptions);
      expect(outcome).toEqual({
        disposition: 'call_local',
        result: {
          status: 'error',
          type: 'remote_error',
          message: 'The remote tool reported an error.',
        },
      });
    } finally {
      await client.close();
    }
  });

  it('leaves no connection or shutdown timer pending after close', async () => {
    vi.useFakeTimers();
    try {
      const transport = createStubTransport(scriptWithDefaults({}));
      const client = await McpServerClient.connect({
        serverId: 'web',
        url: 'https://mcp.test/mcp',
        fetch: transport.fetchStub,
      });
      const pendingBeforeClose = vi.getTimerCount();
      await client.close();
      // Pinned, not compared to a free variable: a connect that left timers
      // behind would satisfy an equal before/after count while still leaking.
      expect(pendingBeforeClose).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a discovery page delivered without a JSON content type', async () => {
    const { client } = await connectStub({
      'tools/list': [
        ({ id }) =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: { tools: [declaration('lookup')] },
            }),
            { headers: { 'content-type': 'application/octet-stream' } },
          ),
      ],
    });

    try {
      await expect(client.discover()).rejects.toBeInstanceOf(
        McpServerOperationError,
      );
    } finally {
      await client.close();
    }
  });
});
