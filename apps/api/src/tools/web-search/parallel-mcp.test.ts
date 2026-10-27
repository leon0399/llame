import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callToolRequestIndex as callRequestIndex,
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  routedMcpFetch as routedFetch,
  type McpFixtureResponse,
  type McpTestFixture,
} from '../../mcp/mcp-test-fixture';

import { type EngineRequest } from './chain';
import { removalFor } from '../../testing/web-search-removal';
import { PARALLEL_MCP_URL, createParallelMcpEngine } from './parallel-mcp';
import { type CapturedRequest } from '../../testing/web-search-fetch';

const parallelTool = {
  name: 'web_search',
  description: 'Search the web with Parallel',
  inputSchema: {
    type: 'object',
    properties: {
      objective: { type: 'string' },
      search_queries: { type: 'array', items: { type: 'string' } },
      session_id: { type: 'string' },
    },
    required: ['objective', 'search_queries'],
    additionalProperties: false,
  },
};

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'pgvector release',
  objective: undefined,
  recency: undefined,
  limit: 2,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  chatId: 'chat-uuid',
  removal: removalFor(undefined),
  ...overrides,
});

/** The payload the hosted tool returns, with vendor text scrubbed. */
const recordedPayload = {
  search_id: 'search_1',
  results: [
    {
      url: 'https://example.test/pgvector',
      title: 'pgvector 0.8.7 Released',
      publish_date: '2026-10-05',
      excerpts: ['# pgvector 0.8.7 Released\n\nIt adds iterators.'],
    },
    {
      url: 'https://example.test/second',
      title: 'Second',
      publish_date: null,
      excerpts: ['Second excerpt'],
    },
    {
      url: 'https://example.test/third',
      title: 'Third',
      publish_date: null,
      excerpts: ['Third excerpt'],
    },
  ],
  warnings: null,
  metadata: null,
  session_id: 'session_1',
};

type TextPart = { readonly type: 'text'; readonly text: string };
type RpcResultBody =
  | { readonly tools: ReadonlyArray<typeof parallelTool> }
  | {
      readonly content: ReadonlyArray<TextPart> | string;
      readonly isError?: boolean;
      readonly structuredContent?: {
        readonly results: ReadonlyArray<unknown>;
      };
    };

function rpcResult(id: number, result: RpcResultBody): McpFixtureResponse {
  return { kind: 'json', body: { jsonrpc: '2.0', id, result } };
}

type ToolResultFields = {
  readonly structuredContent?: {
    readonly results: ReadonlyArray<unknown>;
  };
  readonly isError?: boolean;
};

function toolResult(text: string, extra: ToolResultFields = {}): RpcResultBody {
  return { content: [{ type: 'text', text }], isError: false, ...extra };
}

function fixtureScripts(
  callResponses: ReadonlyArray<McpFixtureResponse>,
  toolLists: ReadonlyArray<ReadonlyArray<typeof parallelTool>> = [
    [parallelTool],
  ],
) {
  return {
    $get: [{ kind: 'raw' as const, status: 405, body: '' }],
    initialize: [
      mcpStreamableHttpInitialize({ sessionId: 'parallel-session' }),
    ],
    'notifications/initialized': [
      { kind: 'raw' as const, status: 204, body: '' },
    ],
    'tools/list': toolLists.map((tools) => rpcResult(1, { tools })),
    'tools/call': callResponses,
    $delete: [{ kind: 'raw' as const, status: 204, body: '' }],
  } satisfies Readonly<Record<string, ReadonlyArray<McpFixtureResponse>>>;
}

let activeFixture: McpTestFixture | undefined;

function currentFixture(): McpTestFixture {
  if (activeFixture === undefined) throw new Error('fixture is not active');
  return activeFixture;
}

afterEach(async () => {
  await activeFixture?.close();
  activeFixture = undefined;
});

describe('Parallel MCP engine', () => {
  it('sends the objective, query, and Chat id, and cuts to the limit', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(JSON.stringify(recordedPayload), {
            structuredContent: recordedPayload,
          }),
        ),
      ]),
    );
    const seen: Array<CapturedRequest> = [];
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), seen),
    });

    await expect(engine(request())).resolves.toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'pgvector 0.8.7 Released',
          url: 'https://example.test/pgvector',
          snippet: 'It adds iterators.',
          published: '2026-10-05',
        },
        {
          title: 'Second',
          url: 'https://example.test/second',
          snippet: 'Second excerpt',
        },
      ],
    });
    expect(seen[0]?.url).toBe(PARALLEL_MCP_URL);
    expect(
      currentFixture().requestMatches(
        callRequestIndex(currentFixture()),
        (body) =>
          z
            .object({
              params: z.object({
                name: z.literal('web_search'),
                arguments: z.object({
                  objective: z.literal('pgvector release'),
                  search_queries: z.tuple([z.literal('pgvector release')]),
                  session_id: z.literal('chat-uuid'),
                }),
              }),
            })
            .safeParse(body).success,
      ),
    ).toBe(true);
    expect(
      currentFixture()
        .requestSummaries()[0]
        ?.headerNames.some(
          (name) => name === 'x-api-key' || name === 'authorization',
        ),
    ).toBe(false);
    expect(new Headers(seen[0]?.init?.headers).get('user-agent')).toContain(
      'llame/test',
    );
  });

  it('sends the call objective over the query', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(JSON.stringify(recordedPayload), {
            structuredContent: recordedPayload,
          }),
        ),
      ]),
    );
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });

    await engine(request({ objective: 'rank primary sources first' }));
    expect(
      currentFixture().requestMatches(
        callRequestIndex(currentFixture()),
        (body) =>
          z
            .object({
              params: z.object({
                arguments: z.object({
                  objective: z.literal('rank primary sources first'),
                  search_queries: z.tuple([z.literal('pgvector release')]),
                }),
              }),
            })
            .safeParse(body).success,
      ),
    ).toBe(true);
  });

  it('notes unsupported recency', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(JSON.stringify(recordedPayload), {
            structuredContent: recordedPayload,
          }),
        ),
      ]),
    );
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });

    await expect(engine(request({ recency: 'day' }))).resolves.toMatchObject({
      kind: 'results',
      notes: ['recency not applied by parallel-mcp'],
    });
  });

  it('maps a tool error to upstream_error without its text', async () => {
    const vendorText =
      'Error executing tool web_search: search_queries must be non-empty';
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(2, {
          content: [{ type: 'text', text: vendorText }],
          isError: true,
          // A tool error wins even when it also carries a payload.
          structuredContent: recordedPayload,
        }),
        rpcResult(
          3,
          toolResult(JSON.stringify(recordedPayload), {
            structuredContent: recordedPayload,
          }),
        ),
      ]),
    );
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });

    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
      message: 'The web search engine failed upstream.',
    });
    // The transport is healthy, so the next call reuses the session.
    await expect(engine(request())).resolves.toMatchObject({
      kind: 'results',
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(1);
  });

  it('rejects a result without a usable search payload', async () => {
    for (const content of [
      // Text that is not JSON.
      [
        { type: 'text', text: 'not json at all' },
      ] satisfies ReadonlyArray<TextPart>,
      // Content that is not a list of parts.
      'not a list',
    ] as const) {
      activeFixture = await createMcpTestFixture(
        fixtureScripts([rpcResult(2, { content })]),
      );
      const engine = createParallelMcpEngine({
        fetch: routedFetch(currentFixture(), []),
      });

      await expect(engine(request())).rejects.toMatchObject({
        failureClass: 'upstream_error',
      });
      await currentFixture().close();
      activeFixture = undefined;
    }
  });

  it('rejects an endpoint that declares no web_search tool', async () => {
    activeFixture = await createMcpTestFixture(fixtureScripts([], [[]]));
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });

    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
  });

  it('maps a 429 transport failure to rate_limited', async () => {
    activeFixture = await createMcpTestFixture({
      $get: [{ kind: 'raw', status: 405, body: '' }],
      initialize: [
        {
          kind: 'raw',
          status: 429,
          body: 'rate limited',
          contentType: 'application/json',
        },
      ],
      'notifications/initialized': [],
      'tools/list': [],
      'tools/call': [],
      $delete: [],
    });
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });

    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'rate_limited',
      message: 'The web search engine rate limited the request.',
    });
  });

  it('maps a transport failure to upstream_error', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([], [[parallelTool]]),
    );
    const engine = createParallelMcpEngine({
      fetch: () => Promise.reject(new Error('connection refused')),
    });

    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
  });

  it('returns empty when the tool finds nothing', async () => {
    const empty = { ...recordedPayload, results: [] };
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(JSON.stringify(empty), {
            structuredContent: empty,
          }),
        ),
      ]),
    );
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });

    await expect(engine(request())).resolves.toStrictEqual({ kind: 'empty' });
  });

  it('keeps another call alive when a call on the shared session fails', async () => {
    const initialized = mcpStreamableHttpInitialize({
      sessionId: 'parallel-session',
    });
    const ok = (id: number) =>
      rpcResult(
        id,
        toolResult(JSON.stringify(recordedPayload), {
          structuredContent: recordedPayload,
        }),
      );
    activeFixture = await createMcpTestFixture({
      $get: [initialized, initialized].map(() => ({
        kind: 'raw' as const,
        status: 405,
        body: '',
      })),
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: 'first-session' }),
        mcpStreamableHttpInitialize({ sessionId: 'second-session' }),
      ],
      'notifications/initialized': [
        { kind: 'raw' as const, status: 204, body: '' },
        { kind: 'raw' as const, status: 204, body: '' },
      ],
      'tools/list': [parallelTool, parallelTool].map((tool) =>
        rpcResult(1, { tools: [tool] }),
      ),
      'tools/call': [
        // The first call fails while the second is still in flight; the third
        // call runs on the session the first one's failure replaced.
        { kind: 'raw', status: 500, body: 'upstream', delayMs: 150 },
        { ...ok(3), delayMs: 250 },
        ok(2),
      ],
      $delete: [
        { kind: 'raw' as const, status: 204, body: '' },
        { kind: 'raw' as const, status: 204, body: '' },
      ],
    });
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });
    const callCount = () =>
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'tools/call').length;
    const initializeCount = () =>
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize').length;

    const failing = engine(request()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(callCount()).toBe(1));
    const other = engine(request());
    expect(await failing).toMatchObject({ failureClass: 'upstream_error' });
    await expect(other).resolves.toMatchObject({ kind: 'results' });
    // The failed call left the cache, so the next call starts a new session.
    await expect(engine(request())).resolves.toMatchObject({ kind: 'results' });
    expect(initializeCount()).toBe(2);
  });

  it('keeps a newer session when an older call fails late', async () => {
    const initialized = mcpStreamableHttpInitialize({
      sessionId: 'parallel-session',
    });
    activeFixture = await createMcpTestFixture({
      $get: [initialized, initialized].map(() => ({
        kind: 'raw' as const,
        status: 405,
        body: '',
      })),
      initialize: [
        mcpStreamableHttpInitialize({ sessionId: 'first-session' }),
        mcpStreamableHttpInitialize({ sessionId: 'second-session' }),
      ],
      'notifications/initialized': [
        { kind: 'raw' as const, status: 204, body: '' },
        { kind: 'raw' as const, status: 204, body: '' },
      ],
      'tools/list': [parallelTool, parallelTool].map((tool) =>
        rpcResult(1, { tools: [tool] }),
      ),
      // The first client numbers its tool calls 2 and 3; the session the
      // third call initializes numbers them from 2 again.
      'tools/call': [
        { kind: 'disconnect', delayMs: 400 },
        rpcResult(3, toolResult('not json at all')),
        rpcResult(
          2,
          toolResult(JSON.stringify(recordedPayload), {
            structuredContent: recordedPayload,
          }),
        ),
        rpcResult(
          3,
          toolResult(JSON.stringify(recordedPayload), {
            structuredContent: recordedPayload,
          }),
        ),
      ],
      $delete: [
        { kind: 'raw' as const, status: 204, body: '' },
        { kind: 'raw' as const, status: 204, body: '' },
        { kind: 'raw' as const, status: 204, body: '' },
      ],
    });
    const engine = createParallelMcpEngine({
      fetch: routedFetch(currentFixture(), []),
    });
    const callCount = () =>
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'tools/call').length;
    const initializeCount = () =>
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize').length;

    const late = engine(request()).catch((error: unknown) => error);
    await vi.waitFor(() => expect(callCount()).toBe(1));
    // A result without a payload drops the session it used.
    await expect(engine(request())).rejects.toMatchObject({
      failureClass: 'upstream_error',
    });
    // The next call initializes the second session.
    await expect(engine(request())).resolves.toMatchObject({ kind: 'results' });
    // The first call's transport failure names the old session, so it must not
    // drop the newer one that replaced it.
    expect(await late).toMatchObject({ failureClass: 'upstream_error' });
    await expect(engine(request())).resolves.toMatchObject({ kind: 'results' });
    expect(initializeCount()).toBe(2);
  });
});
