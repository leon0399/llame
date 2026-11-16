import type { ModelMessage } from 'ai';
import type { ProviderConfig } from '../instance-config/llame-config';
import type { SystemModelCatalogEntry } from './model-catalog';
import { createModelClient } from './model-client-factory';

const KEY = 'provider-credential-9f8e7d6c5b4a';

const model = {
  id: 'chat',
  provider: 'account',
  providerModelId: 'claude-haiku-5-5',
  source: 'system' as const,
  input: ['text'] as const,
  contextWindowTokens: 128_000,
  systemPromptTemplate: 'Test prompt',
  systemPromptSource: 'project_default' as const,
  referencesSkills: false,
};

const messages: Array<ModelMessage> = [{ role: 'user', content: 'Reply.' }];

const requests: Array<{
  url: string;
  headers: Headers;
  body: unknown;
  redirect?: RequestRedirect;
}> = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      const incoming = new Request(url, init);
      requests.push({
        url: incoming.url,
        headers: incoming.headers,
        body: await incoming.json(),
        redirect: init?.redirect,
      });

      return new Response(
        JSON.stringify({
          error: {
            type: 'invalid_request_error',
            message: `rejected ${KEY}`,
          },
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function request(
  provider: ProviderConfig,
  overrides: Partial<
    Pick<
      SystemModelCatalogEntry,
      | 'wire'
      | 'providerModelId'
      | 'maxOutputTokens'
      | 'providerOptions'
      | 'reasoning'
    >
  > = {},
) {
  const client = createModelClient({
    provider,
    model: { ...model, ...overrides },
    userAgent: 'llame/test',
    credentials: [KEY],
  });

  if (provider.type === 'opencode-go')
    expect(client.provider).toBe('opencode-go');

  const failure: unknown = await client
    .streamText({
      chat: { id: 'chat-identity', lane: 'main' },
      messages,
      onError: () => undefined,
    })
    .text.then(
      () => undefined,
      (error: unknown) => error,
    );

  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).not.toContain(KEY);

  return requests.at(-1);
}

const account: ProviderConfig = {
  id: 'account',
  type: 'openrouter',
  key: KEY,
  baseUrl: null,
  headers: {},
};

describe('account routing through real SDK clients', () => {
  it('applies Go Messages options and output limits on the wire', async () => {
    const sent = await request(
      { id: 'account', type: 'opencode-go', key: KEY, headers: {} },
      {
        providerModelId: 'claude-haiku-5-5',
        maxOutputTokens: 256,
        providerOptions: { cacheControl: null },
      },
    );

    expect(sent?.body).toMatchObject({ max_tokens: 256 });
    expect(sent?.body).not.toHaveProperty('cache_control');
    expect(sent?.body).not.toHaveProperty('thinking');
  });

  it('applies Go Responses options without relaxing storage invariants', async () => {
    const sent = await request(
      { id: 'account', type: 'opencode-go', key: KEY, headers: {} },
      {
        providerModelId: 'gpt-5.6-luna',
        maxOutputTokens: 256,
        providerOptions: { reasoningSummary: 'concise', store: true },
      },
    );

    expect(sent?.body).toMatchObject({
      max_output_tokens: 256,
      store: false,
      reasoning: { summary: 'concise' },
    });
  });

  it('enables adaptive thinking for a declared Go Messages reasoning model', async () => {
    const sent = await request(
      { id: 'account', type: 'opencode-go', key: KEY, headers: {} },
      {
        providerModelId: 'claude-haiku-5-5',
        reasoning: {
          effortLevels: [{ value: 'high' }],
          defaultEffort: 'high',
          cacheInvalidatedByEffortChange: true,
        },
      },
    );

    expect(sent?.body).toMatchObject({ thinking: { type: 'adaptive' } });
  });

  it.each([
    ['openai-completions', '/chat/completions', 'authorization'],
    ['openai-responses', '/responses', 'authorization'],
    ['anthropic-messages', '/messages', 'x-api-key'],
  ] as const)(
    'sends the %s override to the same account endpoint',
    async (wire, suffix, credentialHeader) => {
      const sent = await request(
        { ...account, baseUrl: 'https://gateway.example/v1' },
        { wire },
      );

      expect(sent?.url).toBe(`https://gateway.example/v1${suffix}`);
      expect(sent?.headers.get(credentialHeader)).toBe(
        credentialHeader === 'authorization' ? `Bearer ${KEY}` : KEY,
      );
      expect(sent?.body).toMatchObject({ model: 'claude-haiku-5-5' });
      expect(sent?.headers.get('user-agent')).toContain('llame/test');
    },
  );

  it('uses the OpenRouter default without interpreting the model family as a native vendor', async () => {
    const sent = await request(account, {
      providerModelId: 'anthropic/claude-sonnet-4.6',
    });

    expect(sent?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it.each([
    ['claude-haiku-5-5', '/messages', 'x-api-key'],
    ['gpt-5.6-luna', '/responses', 'authorization'],
    ['glm-5.3-flash', '/chat/completions', 'authorization'],
    ['minimax-m3', '/messages', 'x-api-key'],
    ['minimax-m3.1-flash', '/chat/completions', 'authorization'],
  ])(
    'selects the Go wire for %s and keeps its session and redirect boundary',
    async (providerModelId, suffix, credentialHeader) => {
      const sent = await request(
        { id: 'account', type: 'opencode-go', key: KEY, headers: {} },
        { providerModelId },
      );

      expect(sent?.url).toBe(`https://opencode.ai/zen/go/v1${suffix}`);
      expect(sent?.headers.get(credentialHeader)).toBe(
        credentialHeader === 'authorization' ? `Bearer ${KEY}` : KEY,
      );
      expect(sent?.headers.get('x-opencode-session')).toBe('chat-identity');
      expect(sent?.headers.get('x-opencode-client')).toBe('llame');
      expect(sent?.redirect).toBe('manual');
    },
  );

  it('lets an explicit Go wire override the catalog without changing accounts', async () => {
    const sent = await request(
      { id: 'account', type: 'opencode-go', key: KEY, headers: {} },
      { providerModelId: 'minimax-m3', wire: 'openai-completions' },
    );

    expect(sent?.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(sent?.body).toMatchObject({ model: 'minimax-m3' });
  });

  it.each(['claude-haiku-5-5', 'gpt-5.6-luna', 'glm-5.3-flash'])(
    'replaces Go headers case-insensitively for %s',
    async (providerModelId) => {
      const sent = await request(
        {
          id: 'account',
          type: 'opencode-go',
          key: KEY,
          headers: {
            'X-OpenCode-Session': ['operator-session'],
            'X-OpenCode-Client': ['operator-client'],
          },
        },
        { providerModelId },
      );

      expect(sent?.headers.get('x-opencode-session')).toBe('operator-session');
      expect(sent?.headers.get('x-opencode-client')).toBe('operator-client');
    },
  );

  it('does not consult ambient endpoint variables', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://wrong.example');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://wrong.example');
    const openai = await request({ ...account, type: 'openai' });
    expect(openai?.url).toBe('https://api.openai.com/v1/responses');
    const anthropic = await request({ ...account, type: 'anthropic' });
    expect(anthropic?.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('keeps two accounts independent even when the models use the same wire', async () => {
    const first = await request({
      ...account,
      baseUrl: 'https://first.example/v1',
    });

    const second = await request({
      ...account,
      key: 'second-account-key',
      baseUrl: 'https://second.example/v1',
    });

    expect(first?.url).toBe('https://first.example/v1/chat/completions');
    expect(second?.url).toBe('https://second.example/v1/chat/completions');
    expect(first?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(second?.headers.get('authorization')).toBe(
      'Bearer second-account-key',
    );
  });

  it('does not issue a request for a model with an unknown route', () => {
    expect(() =>
      createModelClient({
        provider: { id: 'account', type: 'opencode-go', key: KEY, headers: {} },
        model: { ...model, providerModelId: 'unknown-family' },
        userAgent: 'llame/test',
        credentials: [KEY],
      }),
    ).toThrow('models[chat].wire');
    expect(requests).toEqual([]);
  });
});
