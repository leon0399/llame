import { vi } from 'vitest';
import { type WebSearchConfig } from '../../instance-config/web-search-config';
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
import { requestUrl } from '../../testing/web-search-fetch';
import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { evaluatePermission } from '../permissions/evaluator';
import {
  type CompiledPolicy,
  type PermissionGroup,
  type ToolPermissionMap,
} from '../permissions/types';

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

  it('accepts a bounded objective and refuses an empty or over-long one', () => {
    expect(
      webSearchInputSchema.parse({
        query: 'llame',
        objective: 'compare pgvector benchmarks',
      }),
    ).toEqual({
      query: 'llame',
      objective: 'compare pgvector benchmarks',
      limit: 10,
    });
    expect(
      webSearchInputSchema.safeParse({ query: 'llame', objective: '' }).success,
    ).toBe(false);
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        objective: 'x'.repeat(2000),
      }).success,
    ).toBe(true);
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        objective: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
  });

  it('accepts 1 to 20 unique engine ids and refuses duplicates', () => {
    expect(
      webSearchInputSchema.parse({ query: 'llame', engines: ['brave', 'exa'] }),
    ).toEqual({ query: 'llame', engines: ['brave', 'exa'], limit: 10 });
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        engines: ['brave', 'brave'],
      }).success,
    ).toBe(false);
    expect(
      webSearchInputSchema.safeParse({ query: 'llame', engines: [] }).success,
    ).toBe(false);
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        engines: Array.from({ length: 21 }, (_unused, index) => `e${index}`),
      }).success,
    ).toBe(false);
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        engines: Array.from({ length: 20 }, (_unused, index) => `e${index}`),
      }).success,
    ).toBe(true);
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        engines: ['x'.repeat(65)],
      }).success,
    ).toBe(false);
  });

  it('counts an engine id length in code points, like the configuration', () => {
    // The configuration's 64-character bound counts code points, so an id of
    // 64 astral characters is configured and must stay selectable.
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        engines: ['😀'.repeat(64)],
      }).success,
    ).toBe(true);
    expect(
      webSearchInputSchema.safeParse({
        query: 'llame',
        engines: ['😀'.repeat(65)],
      }).success,
    ).toBe(false);
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

it('forwards the objective to an engine that accepts one', async () => {
  const fetch = vi.fn<VendorFetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          results: [{ title: 'Result', url: 'https://example.test/a' }],
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
      webSearch: {
        engines: [
          { id: 'exa', type: 'exa', key: 'test-key', timeoutSeconds: 60 },
        ],
        chain: ['exa'],
      },
    };
    await expect(
      webSearchTool.execute(context, {
        query: 'llame',
        objective: 'compare pgvector benchmarks',
        limit: 5,
      }),
    ).resolves.toMatchObject({ status: 'success', kind: 'results' });
    const text = await new Response(
      fetch.mock.calls[0]?.[1]?.body ?? null,
    ).text();
    const body: unknown = JSON.parse(text);
    expect(body).toMatchObject({
      query: 'llame',
      objective: 'compare pgvector benchmarks',
    });
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

it('skips an over-long aggregate child and calls only the other engine', async () => {
  const hosts: Array<string> = [];
  const fetch = vi.fn<VendorFetch>((input) => {
    hosts.push(new URL(requestUrl(input)).host);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          results: [{ title: 'Result', url: 'https://example.test/a' }],
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
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
          { id: 'brave', type: 'brave', key: 'brave-key', timeoutSeconds: 60 },
          { id: 'exa', type: 'exa', key: 'exa-key', timeoutSeconds: 60 },
          { id: 'mix', type: 'aggregate', engines: ['brave', 'exa'] },
        ],
        chain: ['mix'],
      },
    };
    const output = await webSearchTool.execute(context, {
      query: 'x'.repeat(650),
      limit: 10,
    });
    // The brave child's declared 600-code-point limit skips it before a
    // request, so only the Exa host is called.
    expect(hosts).toStrictEqual(['api.exa.ai']);
    expect(output).toMatchObject({
      status: 'success',
      kind: 'results',
      engine: 'mix',
      results: [{ title: 'Result', url: 'https://example.test/a' }],
      notes: ['brave: unsupported'],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('refuses an unknown selected engine before any request', async () => {
  const fetch = vi.fn<VendorFetch>(() =>
    Promise.reject(new Error('no request expected')),
  );
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
          { id: 'brave', type: 'brave', key: 'brave-key', timeoutSeconds: 60 },
          { id: 'exa', type: 'exa', key: 'exa-key', timeoutSeconds: 60 },
        ],
        chain: ['brave'],
      },
    };
    await expect(
      webSearchTool.execute(context, {
        query: 'llame',
        engines: ['bing'],
        limit: 10,
      }),
    ).resolves.toStrictEqual({
      status: 'error',
      type: 'web_search_failed',
      message:
        'Unknown web search engine "bing". Configured engines: brave, exa.',
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('runs only the engine the call selects, also an aggregate child', async () => {
  const keys: Array<string | null> = [];
  const fetch = vi.fn<VendorFetch>((_input, init) => {
    keys.push(new Headers(init?.headers).get('X-Subscription-Token'));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          web: {
            results: [{ title: 'Result', url: 'https://example.test/a' }],
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
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
          { id: 'mix', type: 'aggregate', engines: ['first', 'second'] },
        ],
        chain: ['mix'],
      },
    };
    await expect(
      webSearchTool.execute(context, {
        query: 'llame',
        engines: ['second'],
        limit: 10,
      }),
    ).resolves.toMatchObject({
      status: 'success',
      kind: 'results',
      engine: 'second',
      results: [{ title: 'Result', url: 'https://example.test/a' }],
    });
    expect(keys).toStrictEqual(['second-key']);
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

/** A fresh config per call: the tool caches one engine lookup per config. */
const braveSearch = (): WebSearchConfig => ({
  engines: [
    { id: 'brave', type: 'brave', key: 'test-key', timeoutSeconds: 60 },
  ],
  chain: ['brave'],
});
/** The `read` group of the canonical rejected-host scenarios. */
const REJECTING_READ: ToolPermissionMap = {
  read: {
    allow: [{ field: 'path', regex: '^https://' }],
    reject: [{ field: 'path', regex: '^https://grokipedia\\.com/' }],
  },
};
function braveResults(
  results: ReadonlyArray<{ title: string; url: string }>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<VendorFetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ web: { results } }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}
function searchContext(
  permissionPolicy: CompiledPolicy,
  options: {
    mode?: ToolContext['permissionMode'];
    webSearch?: WebSearchConfig;
  } = {},
): ToolContext {
  return {
    userId: 'user',
    chatId: 'chat',
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    permissionPolicy,
    webSearch: options.webSearch ?? braveSearch(),
    ...(options.mode !== undefined && { permissionMode: options.mode }),
  };
}

it('removes the results a read reject clause matches and counts them in the first note', async () => {
  braveResults([
    { title: 'Rejected', url: 'https://grokipedia.com/page' },
    { title: 'Kept one', url: 'https://example.test/a' },
    { title: 'Kept two', url: 'https://example.test/b' },
  ]);
  try {
    const policy = compileToolPermissionMap(REJECTING_READ, 'test-policy');
    const output = await webSearchTool.execute(searchContext(policy), {
      query: 'llame',
      limit: 10,
    });
    expect(output).toMatchObject({
      status: 'success',
      kind: 'results',
      engine: 'brave',
      results: [
        { url: 'https://example.test/a' },
        { url: 'https://example.test/b' },
      ],
      notes: ['removed 1 entry'],
    });
    expect(JSON.stringify(output)).not.toContain('grokipedia');
    // The removal filters this call only: `read` still refuses the URL.
    expect(
      evaluatePermission(policy, {
        toolId: 'read',
        args: { path: 'https://grokipedia.com/page' },
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('removes a result by the canonical URL the output shows', async () => {
  braveResults([
    { title: 'Colon in the path', url: 'https://Grokipedia.com/wiki/Talk:Foo' },
    { title: 'Kept', url: 'https://example.test/a' },
  ]);
  try {
    const policy = compileToolPermissionMap(REJECTING_READ, 'test-policy');
    const output = await webSearchTool.execute(searchContext(policy), {
      query: 'llame',
      limit: 10,
    });
    expect(output).toMatchObject({
      status: 'success',
      results: [{ title: 'Kept', url: 'https://example.test/a' }],
      notes: ['removed 1 entry'],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

const KEEPING_READ_GROUPS: ReadonlyArray<[string, PermissionGroup]> = [
  ['no web allow', { allow: [{ field: 'path', regex: '^/' }] }],
  ['a whole-tool reject', { reject: true }],
];
it.each(KEEPING_READ_GROUPS)(
  'keeps every result when the read group has %s',
  async (_case, read) => {
    braveResults([
      { title: 'First', url: 'https://grokipedia.com/page' },
      { title: 'Second', url: 'https://example.test/a' },
    ]);
    try {
      const policy = compileToolPermissionMap({ read }, 'test-policy');
      const output = await webSearchTool.execute(searchContext(policy), {
        query: 'llame',
        limit: 10,
      });
      expect(output).toMatchObject({
        status: 'success',
        results: [
          { url: 'https://grokipedia.com/page' },
          { url: 'https://example.test/a' },
        ],
      });
      expect(output).not.toHaveProperty('notes');
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it('keeps a rejected host in the bypass mode and discloses no note', async () => {
  braveResults([
    { title: 'First', url: 'https://grokipedia.com/page' },
    { title: 'Second', url: 'https://example.test/a' },
  ]);
  try {
    const policy = compileToolPermissionMap(REJECTING_READ, 'test-policy');
    const output = await webSearchTool.execute(
      searchContext(policy, { mode: 'bypass' }),
      { query: 'llame', limit: 10 },
    );
    expect(output).toMatchObject({
      status: 'success',
      results: [
        { url: 'https://grokipedia.com/page' },
        { url: 'https://example.test/a' },
      ],
    });
    expect(output).not.toHaveProperty('notes');
    expect(JSON.stringify(output)).not.toContain('bypass');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('removes an excluded -site: host, its subdomains, an IDN and a dotted host', async () => {
  braveResults([
    { title: 'Subdomain', url: 'https://old.reddit.com/r/one' },
    { title: 'Host', url: 'https://reddit.com/r/two' },
    { title: 'IDN', url: 'https://xn--bcher-kva.de/catalog' },
    { title: 'Kept', url: 'https://example.test/a' },
  ]);
  try {
    const policy = compileToolPermissionMap(
      { read: { allow: true } },
      'test-policy',
    );
    const output = await webSearchTool.execute(searchContext(policy), {
      query: 'pgvector -site:Reddit.com. -site:bücher.de',
      limit: 10,
    });
    expect(output).toMatchObject({
      status: 'success',
      results: [{ url: 'https://example.test/a' }],
      notes: ['removed 3 entries'],
    });
    expect(JSON.stringify(output)).not.toContain('reddit.com/r');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('puts one count note before the engine notes of an aggregate', async () => {
  type Entry = { readonly title: string; readonly url: string };
  const entriesOf = (key: string | null): ReadonlyArray<Entry> =>
    key === 'first-key'
      ? [
          { title: 'Rejected one', url: 'https://reddit.com/r/one' },
          { title: 'Rejected two', url: 'https://old.reddit.com/r/two' },
          { title: 'Kept one', url: 'https://example.test/u1' },
        ]
      : key === 'second-key'
        ? [
            { title: 'Rejected three', url: 'https://www.reddit.com/r/three' },
            { title: 'Kept two', url: 'https://example.test/u2' },
          ]
        : [];
  vi.stubGlobal(
    'fetch',
    vi.fn<VendorFetch>((_input, init) => {
      const key = new Headers(init?.headers).get('X-Subscription-Token');
      return Promise.resolve(
        new Response(JSON.stringify({ web: { results: entriesOf(key) } }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  try {
    const policy = compileToolPermissionMap(
      { read: { allow: true } },
      'test-policy',
    );
    const output = await webSearchTool.execute(
      searchContext(policy, {
        webSearch: {
          engines: [
            ...['first', 'second', 'third'].map((id) => ({
              id,
              type: 'brave' as const,
              key: `${id}-key`,
              timeoutSeconds: 60,
            })),
            {
              id: 'mix',
              type: 'aggregate',
              engines: ['first', 'second', 'third'],
            },
          ],
          chain: ['mix'],
        },
      }),
      { query: 'pgvector -site:reddit.com', limit: 10 },
    );
    expect(output).toMatchObject({
      status: 'success',
      kind: 'results',
      engine: 'mix',
      results: [
        { url: 'https://example.test/u1' },
        { url: 'https://example.test/u2' },
      ],
      notes: ['removed 3 entries', 'third: empty'],
    });
    expect(JSON.stringify(output)).not.toContain('reddit.com/r');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('runs a hosted child inside an aggregate and returns its answer', async () => {
  const config: WebSearchConfig = {
    engines: [
      {
        id: 'claude',
        type: 'model-hosted',
        model: 'search-model',
        wire: 'openai-responses',
        timeoutSeconds: 60,
      },
      {
        id: 'gpt',
        type: 'model-hosted',
        model: 'other-model',
        wire: 'openai-responses',
        timeoutSeconds: 60,
      },
      { id: 'mix', type: 'aggregate', engines: ['claude', 'gpt'] },
    ],
    chain: ['mix'],
  };
  // Each hosted child answers with its own model id and cites it, so the
  // attached answer belongs to the child that requested it.
  const clientFor = (modelId: string) =>
    scriptedModelClient(
      () =>
        Promise.resolve(
          answerStream(modelId, [
            urlSourcePart(`https://example.test/${modelId}`),
          ]),
        ),
      [],
    );

  const output = await webSearchTool.execute(
    {
      userId: 'user',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
      webSearch: config,
      modelClients: { createClient: clientFor },
    },
    { query: 'latest', limit: 10 },
  );

  expect(output).toStrictEqual({
    status: 'success',
    kind: 'results',
    engine: 'mix',
    query: 'latest',
    results: [
      { title: '', url: 'https://example.test/search-model' },
      { title: '', url: 'https://example.test/other-model' },
    ],
    answers: [
      {
        engine: 'claude',
        answer: 'search-model',
        citations: [{ url: 'https://example.test/search-model' }],
      },
      {
        engine: 'gpt',
        answer: 'other-model',
        citations: [{ url: 'https://example.test/other-model' }],
      },
    ],
  });
});
