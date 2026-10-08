import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  type McpFixtureResponse,
  type McpTestFixture,
} from '../../mcp/mcp-test-fixture';
import { type EngineRequest } from './chain';
import { EXA_MCP_URL, createExaMcpEngine } from './exa-mcp';
import { requestUrl, type CapturedRequest } from './test-fetch';
import { type VendorFetch } from './http';
const exaTool = {
  name: 'web_search_exa',
  description: 'Real-time web search using Exa AI',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      numResults: { type: 'number' },
      objective: { type: 'string' },
    },
    required: ['query', 'numResults', 'objective'],
    additionalProperties: false,
  },
};

const request = (overrides: Partial<EngineRequest> = {}): EngineRequest => ({
  query: 'latest llame release',
  recency: undefined,
  limit: 4,
  signal: new AbortController().signal,
  userAgent: 'llame/test',
  ...overrides,
});

type TextToolResult = {
  readonly content: ReadonlyArray<{
    readonly type: 'text';
    readonly text: string;
  }>;
  readonly isError?: true;
};
type JsonResult =
  | { readonly tools: ReadonlyArray<typeof exaTool> }
  | TextToolResult
  | {
      readonly content: ReadonlyArray<{
        readonly type: 'image';
        readonly data: string;
      }>;
    };

function rpcResult(id: number, result: JsonResult): McpFixtureResponse {
  return {
    kind: 'json',
    body: { jsonrpc: '2.0', id, result },
  };
}

function toolResult(text: string, isError = false): TextToolResult {
  const result: TextToolResult = {
    content: [{ type: 'text', text }],
  };
  if (!isError) return result;
  return { ...result, isError: true };
}

function fixtureScripts(
  callResponses: ReadonlyArray<McpFixtureResponse>,
  initializeResponses: ReadonlyArray<McpFixtureResponse> = [
    mcpStreamableHttpInitialize({ sessionId: 'exa-session' }),
  ],
) {
  return {
    $get: [{ kind: 'raw', status: 405, body: '' }],
    initialize: initializeResponses,
    'notifications/initialized': initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 204,
      body: '',
    })),
    'tools/list': initializeResponses.map(() =>
      rpcResult(1, { tools: [exaTool] }),
    ),
    'tools/call': callResponses,
    $delete: initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 204,
      body: '',
    })),
  } satisfies Readonly<Record<string, ReadonlyArray<McpFixtureResponse>>>;
}

function routedFetch(
  fixture: McpTestFixture,
  seen: Array<CapturedRequest>,
): VendorFetch {
  return async (input, init) => {
    seen.push({ url: requestUrl(input), init });
    return globalThis.fetch(fixture.url, init);
  };
}

function callRequestIndex(fixture: McpTestFixture): number {
  const index = fixture
    .requestSummaries()
    .findIndex(({ rpcMethod }) => rpcMethod === 'tools/call');
  if (index < 0) throw new Error('missing tools/call request');
  return index;
}

const SearchCallSchema = z.object({
  params: z.object({
    arguments: z.object({
      query: z.string(),
      numResults: z.number(),
      objective: z.string(),
    }),
  }),
});
type SearchCallBody = z.infer<typeof SearchCallSchema>;

const isSearchCall = (body: SearchCallBody): boolean => {
  const values = body.params.arguments;
  return (
    values.query === 'latest llame release' &&
    values.numResults === 4 &&
    values.objective === 'latest llame release'
  );
};

let activeFixture: McpTestFixture | undefined;

function currentFixture(): McpTestFixture {
  if (activeFixture === undefined) throw new Error('fixture is not active');
  return activeFixture;
}

afterEach(async () => {
  await activeFixture?.close();
  activeFixture = undefined;
});

describe('Exa MCP engine', () => {
  it('normalizes result blocks, sends objective, and notes unsupported recency', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(
            'Title: First result\nURL: https://example.test/first\nPublished: 2026-01-02\nHighlights:\nA useful highlight.\n\n---\n\nTitle: Missing URL\nHighlights: skip this block\n\n---\n\nTitle: Second result\nURL: https://example.test/second\nPublished: not-a-date\nHighlights: second highlight',
          ),
        ),
      ]),
    );
    const seen: Array<CapturedRequest> = [];
    const engine = createExaMcpEngine(
      { key: 'exa-secret' },
      { fetch: routedFetch(currentFixture(), seen) },
    );

    await expect(engine(request({ recency: 'week' }))).resolves.toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'First result',
          url: 'https://example.test/first',
          published: '2026-01-02',
          snippet: 'A useful highlight.',
        },
        {
          title: 'Second result',
          url: 'https://example.test/second',
          snippet: 'second highlight',
        },
      ],
      notes: ['recency not applied by exa-mcp'],
    });
    const index = callRequestIndex(currentFixture());
    expect(
      currentFixture().requestMatches(index, (body) => {
        const parsed = SearchCallSchema.safeParse(body);
        return parsed.success && isSearchCall(parsed.data);
      }),
    ).toBe(true);
    expect(seen[0]?.url).toBe(EXA_MCP_URL);
    expect(new Headers(seen[0]?.init?.headers).get('user-agent')).toContain(
      'llame/test',
    );
    expect(
      currentFixture().receivedHeaderMatching(
        ({ rpcMethod }) => rpcMethod === 'initialize',
        'x-api-key',
        'exa-secret',
      ),
    ).toBe(true);
  });

  it('reuses one client and bounds highlights across calls', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(
            `Title: One\nURL: https://example.test/one\nHighlights: ${'h'.repeat(350)}`,
          ),
        ),
        rpcResult(3, toolResult('Title: Two\nURL: https://example.test/two')),
      ]),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request())).resolves.toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'One',
          url: 'https://example.test/one',
          snippet: 'h'.repeat(300),
        },
      ],
    });
    await expect(engine(request())).resolves.toStrictEqual({
      kind: 'results',
      results: [{ title: 'Two', url: 'https://example.test/two' }],
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(1);
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'tools/list'),
    ).toHaveLength(1);
  });

  it('omits the key header for a keyless engine', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult('No search results found. Please try a different query.'),
        ),
      ]),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request())).resolves.toStrictEqual({ kind: 'empty' });
    expect(
      currentFixture()
        .requestSummaries()
        .every(({ headerNames }) =>
          headerNames.every((name) => name !== 'x-api-key'),
        ),
    ).toBe(true);
  });

  it('maps isError statuses and Exa free-limit text to fixed failures', async () => {
    const cases = [
      ['(401) invalid key', 'auth'],
      ['(403) invalid key', 'auth'],
      ['(429) too many requests', 'rate_limited'],
      [
        "You've hit Exa's free MCP rate limit. Try again later.",
        'rate_limited',
      ],
      ['(500) upstream failed', 'upstream_error'],
    ] as const;

    for (const [text, failureClass] of cases) {
      activeFixture = await createMcpTestFixture(
        fixtureScripts([rpcResult(2, toolResult(text, true))]),
      );
      const engine = createExaMcpEngine(
        { key: undefined },
        { fetch: routedFetch(currentFixture(), []) },
      );

      await expect(engine(request())).rejects.toMatchObject({
        name: 'EngineFailure',
        failureClass,
      });
      await currentFixture().close();
      activeFixture = undefined;
    }
  });

  it('maps an HTTP 429 transport failure to rate_limited', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        {
          kind: 'raw',
          status: 429,
          body: 'rate limited',
          contentType: 'application/json',
        },
      ]),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request())).rejects.toMatchObject({
      name: 'EngineFailure',
      failureClass: 'rate_limited',
    });
  });

  it('reconnects after a dropped MCP session', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts(
        [
          { kind: 'disconnect' },
          rpcResult(
            2,
            toolResult(
              'Title: Reconnected\nURL: https://example.test/reconnected',
            ),
          ),
        ],
        [
          mcpStreamableHttpInitialize({ sessionId: 'first-session' }),
          mcpStreamableHttpInitialize({ sessionId: 'second-session' }),
        ],
      ),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request())).rejects.toMatchObject({
      name: 'EngineFailure',
      failureClass: 'upstream_error',
    });
    await expect(engine(request())).resolves.toStrictEqual({
      kind: 'results',
      results: [
        {
          title: 'Reconnected',
          url: 'https://example.test/reconnected',
        },
      ],
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(2);
  });

  it('rethrows a call-signal abort without classifying it', async () => {
    activeFixture = await createMcpTestFixture(fixtureScripts([]));
    const reason = new Error('cancelled by caller');
    const controller = new AbortController();
    controller.abort(reason);
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request({ signal: controller.signal }))).rejects.toBe(
      reason,
    );
    expect(currentFixture().requestSummaries()).toHaveLength(0);
  });

  it('fails text that contains no URL-bearing result block', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult('Title: Missing URL\nHighlights: not a result'),
        ),
      ]),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request())).rejects.toMatchObject({
      name: 'EngineFailure',
      failureClass: 'upstream_error',
    });
  });

  it('rejects malformed tool content without exposing it', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(2, { content: [{ type: 'image', data: 'secret' }] }),
      ]),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );

    await expect(engine(request())).rejects.toMatchObject({
      name: 'EngineFailure',
      failureClass: 'upstream_error',
    });
  });
});
