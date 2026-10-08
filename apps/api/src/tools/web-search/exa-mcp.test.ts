import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  type McpFixtureResponse,
  type McpTestFixture,
} from '../../mcp/mcp-test-fixture';
import { type EngineRequest } from './chain';
import { EXA_MCP_URL, createExaMcpEngine } from './exa-mcp';
import {
  requestUrl,
  type CapturedRequest,
} from '../../testing/web-search-fetch';
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
  chatId: undefined,
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
  return {
    content: [{ type: 'text', text }],
    ...(isError && { isError: true as const }),
  };
}

function fixtureScripts(
  callResponses: ReadonlyArray<McpFixtureResponse>,
  initializeResponses: ReadonlyArray<McpFixtureResponse> = [
    mcpStreamableHttpInitialize({ sessionId: 'exa-session' }),
  ],
  toolLists: ReadonlyArray<
    ReadonlyArray<typeof exaTool>
  > = initializeResponses.map(() => [exaTool]),
) {
  return {
    $get: initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 405,
      body: '',
    })),
    initialize: initializeResponses,
    'notifications/initialized': initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 204,
      body: '',
    })),
    'tools/list': toolLists.map((tools) => rpcResult(1, { tools })),
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
      query: z.literal('latest llame release'),
      numResults: z.literal(4),
      objective: z.literal('latest llame release'),
    }),
  }),
});

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
            'Title: First result\nURL: https://example.test/first\nPublished: 2026-01-02\nHighlights:\nA useful highlight.\n\n---\n\nTitle: Missing URL\nHighlights: skip this block\n\n---\n\nTitle: Second result\nURL: https://example.test/second\nHighlights: second highlight',
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
      currentFixture().requestMatches(
        index,
        (body) => SearchCallSchema.safeParse(body).success,
      ),
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

  it('parses indented fields and keeps field-looking highlight text', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        rpcResult(
          2,
          toolResult(
            [
              '  Title: Parsed result',
              '  URL: https://example.test/parsed  ',
              'Author: Example',
              'Published: 2026-13-01   ',
              'Highlights:',
              'first   highlight',
              '',
              '  second highlight',
              'URL: https://ignored.example/',
              '---',
              'Title: Datetime result',
              'URL: https://example.test/datetime  ',
              'Published: 2026-01-02T03:04:05Z   ',
              'Highlights: final highlight',
              '---',
              'Title: Text result',
              'URL: https://example.test/text',
              'Text: fallback text',
              '---',
              'Title: Empty URL',
              'URL:   ',
              'Highlights: discarded',
            ].join('\n'),
          ),
        ),
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
          title: 'Parsed result',
          url: 'https://example.test/parsed',
          published: '2026-13-01',
          snippet:
            'first highlight second highlight URL: https://ignored.example/',
        },
        {
          title: 'Datetime result',
          url: 'https://example.test/datetime',
          published: '2026-01-02T03:04:05Z',
          snippet: 'final highlight',
        },
        {
          title: 'Text result',
          url: 'https://example.test/text',
          snippet: 'fallback text',
        },
      ],
    });
  });
  it('keeps shared initialization after the first caller aborts', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts(
        [
          rpcResult(
            2,
            toolResult('Title: Recovered\nURL: https://example.test/recovered'),
          ),
        ],
        [
          {
            ...mcpStreamableHttpInitialize({ sessionId: 'exa-session' }),
            delayMs: 100,
          },
        ],
      ),
    );
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );
    const controller = new AbortController();
    const first = engine(request({ signal: controller.signal }));
    await vi.waitFor(() => {
      expect(
        currentFixture()
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
      ).toHaveLength(1);
    });
    const second = engine(request());
    const reason = new Error('first caller cancelled');
    controller.abort(reason);

    await expect(first).rejects.toBe(reason);
    await expect(second).resolves.toStrictEqual({
      kind: 'results',
      results: [{ title: 'Recovered', url: 'https://example.test/recovered' }],
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(1);
  });

  it('lets a caller abort while shared tools are being discovered', async () => {
    const scripts = fixtureScripts([]);
    activeFixture = await createMcpTestFixture({
      ...scripts,
      'tools/list': scripts['tools/list'].map((response) => ({
        ...response,
        delayMs: 200,
      })),
    });
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );
    const controller = new AbortController();
    const pending = engine(request({ signal: controller.signal }));
    await vi.waitFor(() => {
      expect(
        currentFixture()
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/list'),
      ).toHaveLength(1);
    });
    const reason = new DOMException('deadline exceeded', 'TimeoutError');
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it('reuses one client and leaves output caps to normalization', async () => {
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
          snippet: 'h'.repeat(350),
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

  it('maps isError statuses and keeps the client for the next call', async () => {
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
        fixtureScripts([
          rpcResult(2, toolResult(text, true)),
          rpcResult(
            3,
            toolResult('Title: Recovered\nURL: https://example.test/recovered'),
          ),
        ]),
      );
      const engine = createExaMcpEngine(
        { key: undefined },
        { fetch: routedFetch(currentFixture(), []) },
      );

      await expect(engine(request())).rejects.toMatchObject({
        name: 'EngineFailure',
        failureClass,
      });
      await expect(engine(request())).resolves.toStrictEqual({
        kind: 'results',
        results: [
          { title: 'Recovered', url: 'https://example.test/recovered' },
        ],
      });
      expect(
        currentFixture()
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
      ).toHaveLength(1);
      await currentFixture().close();
      activeFixture = undefined;
    }
  });

  it('maps HTTP 401 and 403 transport failures to auth', async () => {
    for (const status of [401, 403]) {
      activeFixture = await createMcpTestFixture(
        fixtureScripts([], [{ kind: 'raw', status, body: 'denied' }]),
      );
      const engine = createExaMcpEngine(
        { key: 'exa-secret' },
        { fetch: routedFetch(currentFixture(), []) },
      );

      await expect(engine(request())).rejects.toMatchObject({
        name: 'EngineFailure',
        failureClass: 'auth',
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

  it('reconnects after a missing MCP tool', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts(
        [
          rpcResult(
            2,
            toolResult('Title: Recovered\nURL: https://example.test/recovered'),
          ),
        ],
        [
          mcpStreamableHttpInitialize({ sessionId: 'first-session' }),
          mcpStreamableHttpInitialize({ sessionId: 'second-session' }),
        ],
        [[], [exaTool]],
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
      results: [{ title: 'Recovered', url: 'https://example.test/recovered' }],
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(2);
  });

  it('reconnects after a URL-less result failure', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts(
        [
          rpcResult(
            2,
            toolResult('Title: Missing URL\nHighlights: not a result'),
          ),
          rpcResult(
            2,
            toolResult('Title: Recovered\nURL: https://example.test/recovered'),
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
      results: [{ title: 'Recovered', url: 'https://example.test/recovered' }],
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(2);
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

  it('keeps the client after an in-flight call abort', async () => {
    activeFixture = await createMcpTestFixture(
      fixtureScripts([
        {
          ...rpcResult(
            2,
            toolResult('Title: First\nURL: https://example.test/first'),
          ),
          delayMs: 200,
        },
        rpcResult(
          3,
          toolResult('Title: Second\nURL: https://example.test/second'),
        ),
      ]),
    );
    const controller = new AbortController();
    const reason = 'cancelled by caller';
    const engine = createExaMcpEngine(
      { key: undefined },
      { fetch: routedFetch(currentFixture(), []) },
    );
    const pending = engine(request({ signal: controller.signal }));
    await vi.waitFor(() => {
      expect(currentFixture().requestSummaries()).toContainEqual(
        expect.objectContaining({ rpcMethod: 'tools/call' }),
      );
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    await expect(engine(request())).resolves.toStrictEqual({
      kind: 'results',
      results: [{ title: 'Second', url: 'https://example.test/second' }],
    });
    expect(
      currentFixture()
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(1);
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
