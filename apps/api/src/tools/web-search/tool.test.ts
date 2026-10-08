import { vi } from 'vitest';
import { type WebSearchConfig } from '../../instance-config/llame-config';
import {
  type ModelClient,
  type ModelStreamInput,
} from '../../models/model-client';
import {
  answerStream,
  scriptedModelClient,
  urlSourcePart,
} from '../../testing/hosted-search-client';
import { type ToolContext } from '../types';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
} from '../../mcp/mcp-test-fixture';
import { webSearchInputSchema, webSearchTool } from './tool';
import { type VendorFetch } from './http';

describe('web search tool declaration', () => {
  it('rejects an engine argument and defaults limit to ten', () => {
    expect(
      webSearchInputSchema.safeParse({ query: 'llame', engine: 'brave' })
        .success,
    ).toBe(false);
    expect(webSearchInputSchema.parse({ query: 'llame' })).toEqual({
      query: 'llame',
      limit: 10,
    });
  });

  it('uses the stable read-only declaration and fixed unconfigured error', async () => {
    const context: ToolContext = {
      userId: 'user',
      chatId: 'chat',
      tenantDb: {
        runAs: () => Promise.reject(new Error('unused')),
      },
    };

    expect(webSearchTool.id).toBe('web_search');
    expect(webSearchTool.classification).toBe('read_only');
    expect(webSearchTool.timeoutSeconds).toBeUndefined();
    await expect(
      webSearchTool.execute(context, { query: 'llame', limit: 10 }),
    ).resolves.toEqual({
      status: 'error',
      type: 'web_search_failed',
      message: 'Web search is not configured.',
    });
  });
});
it('passes the chat id and each call’s model clients to hosted search', async () => {
  const calls: Array<ModelStreamInput> = [];
  const client = scriptedModelClient(
    () =>
      Promise.resolve(
        answerStream('grounded', [urlSourcePart('https://example.test/a')]),
      ),
    calls,
  );
  const firstCreate = vi.fn<(modelId: string) => ModelClient>(() => client);
  const secondCreate = vi.fn<(modelId: string) => ModelClient>(() => client);
  const firstModelClients = { createClient: firstCreate };
  const secondModelClients = { createClient: secondCreate };
  const config: WebSearchConfig = {
    engines: [
      {
        id: 'hosted',
        type: 'model-hosted',
        model: 'search-model',
        wire: 'openai-responses',
        timeoutSeconds: 60,
      },
    ],
    chain: ['hosted'],
  };
  const baseContext: Omit<ToolContext, 'chatId' | 'modelClients'> = {
    userId: 'user',
    tenantDb: {
      runAs: () => Promise.reject(new Error('unused')),
    },
    webSearch: config,
  };
  const input = { query: 'latest', limit: 1 };
  const expected = {
    status: 'success',
    kind: 'answer',
    engine: 'hosted',
    query: 'latest',
    answer: 'grounded',
    citations: [{ url: 'https://example.test/a' }],
  };
  await expect(
    webSearchTool.execute(
      { ...baseContext, chatId: 'chat-one', modelClients: firstModelClients },
      input,
    ),
  ).resolves.toStrictEqual(expected);
  await expect(
    webSearchTool.execute(
      { ...baseContext, chatId: 'chat-two', modelClients: firstModelClients },
      input,
    ),
  ).resolves.toStrictEqual(expected);
  expect(firstCreate).toHaveBeenCalledTimes(2);
  expect(secondCreate).not.toHaveBeenCalled();
  expect(calls.map((call) => call.chat)).toStrictEqual([
    { id: 'chat-one', lane: 'search' },
    { id: 'chat-two', lane: 'search' },
  ]);

  await expect(
    webSearchTool.execute(
      {
        ...baseContext,
        chatId: 'chat-three',
        modelClients: secondModelClients,
      },
      input,
    ),
  ).resolves.toStrictEqual(expected);
  expect(secondCreate).toHaveBeenCalledTimes(1);
});

it('forwards recency and the product user agent to the configured engine', async () => {
  const fetch = vi.fn<VendorFetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Result',
                url: 'https://example.test/a',
              },
            ],
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    const context: ToolContext = {
      userId: 'user',
      chatId: 'chat',
      tenantDb: {
        runAs: () => Promise.reject(new Error('unused')),
      },
      productUserAgent: 'llame/test',
      webSearch: {
        engines: [
          {
            id: 'brave',
            type: 'brave',
            key: 'test-key',
            timeoutSeconds: 60,
          },
        ],
        chain: ['brave'],
      },
    };
    await expect(
      webSearchTool.execute(context, {
        query: 'llame',
        recency: 'day',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      status: 'success',
      kind: 'results',
      results: [{ title: 'Result', url: 'https://example.test/a' }],
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    const requestUrl =
      url instanceof Request ? url.url : url instanceof URL ? url.href : url;
    expect(new URL(requestUrl).searchParams.get('freshness')).toBe('pd');
    expect(new Headers(init?.headers).get('User-Agent')).toBe('llame/test');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('wires aggregate children and merges their results', async () => {
  const fetch = vi.fn<VendorFetch>((_input, init) => {
    const key = new Headers(init?.headers).get('X-Subscription-Token');
    const entries =
      key === 'first-key'
        ? [
            { title: 'First', url: 'https://example.test/u1' },
            { title: 'Second', url: 'https://example.test/u2' },
          ]
        : [
            { title: 'Third', url: 'https://example.test/u3' },
            { title: 'Shared', url: 'https://example.test/u1' },
          ];
    return Promise.resolve(
      new Response(JSON.stringify({ web: { results: entries } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  try {
    const context: ToolContext = {
      userId: 'user',
      chatId: 'chat',
      tenantDb: {
        runAs: () => Promise.reject(new Error('unused')),
      },
      webSearch: {
        engines: [
          {
            id: 'first',
            type: 'brave',
            key: 'first-key',
            timeoutSeconds: 60,
          },
          {
            id: 'second',
            type: 'brave',
            key: 'second-key',
            timeoutSeconds: 60,
          },
          {
            id: 'mix',
            type: 'aggregate',
            engines: ['first', 'second'],
          },
        ],
        chain: ['mix'],
      },
    };

    await expect(
      webSearchTool.execute(context, { query: 'llame', limit: 10 }),
    ).resolves.toStrictEqual({
      status: 'success',
      kind: 'results',
      engine: 'mix',
      query: 'llame',
      results: [
        { title: 'First', url: 'https://example.test/u1' },
        { title: 'Third', url: 'https://example.test/u3' },
        { title: 'Second', url: 'https://example.test/u2' },
      ],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('reuses one Exa MCP client across tool executions', async () => {
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
  type RpcResult =
    | { readonly tools: ReadonlyArray<typeof exaTool> }
    | {
        readonly content: ReadonlyArray<{
          readonly type: 'text';
          readonly text: string;
        }>;
      };
  const rpcResult = (id: number, result: RpcResult) => ({
    kind: 'json' as const,
    body: { jsonrpc: '2.0', id, result },
  });
  const fixture = await createMcpTestFixture({
    $get: [{ kind: 'raw', status: 405, body: '' }],
    initialize: [mcpStreamableHttpInitialize({ sessionId: 'exa-session' })],
    'notifications/initialized': [{ kind: 'raw', status: 204, body: '' }],
    'tools/list': [rpcResult(1, { tools: [exaTool] })],
    'tools/call': [
      rpcResult(2, {
        content: [
          {
            type: 'text',
            text: 'Title: First\nURL: https://example.test/first',
          },
        ],
      }),
      rpcResult(3, {
        content: [
          {
            type: 'text',
            text: 'Title: Second\nURL: https://example.test/second',
          },
        ],
      }),
    ],
    $delete: [{ kind: 'raw', status: 204, body: '' }],
  });
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn<VendorFetch>((_input, init) =>
    originalFetch(fixture.url, init),
  );
  vi.stubGlobal('fetch', fetch);
  const context: ToolContext = {
    userId: 'user',
    chatId: 'chat',
    tenantDb: {
      runAs: () => Promise.reject(new Error('unused')),
    },
    webSearch: {
      engines: [
        {
          id: 'exa-mcp',
          type: 'exa-mcp',
          key: undefined,
          timeoutSeconds: 60,
        },
      ],
      chain: ['exa-mcp'],
    },
  };

  try {
    await expect(
      webSearchTool.execute(context, { query: 'first', limit: 1 }),
    ).resolves.toMatchObject({
      status: 'success',
      kind: 'results',
      results: [{ url: 'https://example.test/first' }],
    });
    await expect(
      webSearchTool.execute(context, { query: 'second', limit: 1 }),
    ).resolves.toMatchObject({
      status: 'success',
      kind: 'results',
      results: [{ url: 'https://example.test/second' }],
    });
    expect(
      fixture
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await fixture.close();
  }
});
