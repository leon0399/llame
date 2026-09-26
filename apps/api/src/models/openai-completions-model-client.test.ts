/**
 * `createOpenAICompletionsModelClient` — the Chat Completions wire client
 * (`provider-api-selection`: an `openai-completions` entry executes Chat
 * Completions at its required base URL). The
 * `@ai-sdk/openai-compatible` provider factory is replaced at its boundary
 * through the client's own dependency seam; AI SDK `streamText`, step
 * scheduling, and tool validation remain real wherever behavior is under
 * test (MockLanguageModelV3 + `simulateReadableStream` fixtures, as in
 * `openai-model-client.tools.test.ts`).
 */
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  simulateReadableStream,
  streamText,
  tool,
  type ModelMessage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import { type ChatIdentity, type ModelObjectInput } from './model-client';
import {
  createOpenAICompletionsModelClient,
  type OpenAICompletionsModelClientConfig,
  type OpenAICompletionsModelClientDependencies,
} from './openai-completions-model-client';
import { KEYLESS_PLACEHOLDER_API_KEY } from './openai-model-client';

// Test seam (anti-slop/no-module-mocking): overrides the AI SDK's
// provider-factory (`@ai-sdk/openai-compatible`) and streaming entry point
// instead of module-mocking them. Production call sites never pass this —
// the default is the real SDK.
const createOpenAICompatibleMock = vi.mocked(
  vi.fn<typeof createOpenAICompatible>(),
  { partial: true },
);
const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
  partial: true,
});

const messages = [
  { role: 'user', content: 'Use the available tools.' },
] satisfies Array<ModelMessage>;

/**
 * The Chat identity every input carries (design D3). It is a fact the client
 * receives: nothing in this suite asserts that a client reads it.
 */
const CHAT: ChatIdentity = { id: 'chat-test', lane: 'main' };

/** The product token llame's boot-read identity supplies to every client. */
const USER_AGENT = 'llame/0.0.0-test';

const PROVIDER_USAGE = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function providerResponse(
  content: Array<LanguageModelV3StreamPart>,
  finishReason: 'stop' | 'tool-calls',
) {
  return {
    stream: simulateReadableStream<LanguageModelV3StreamPart>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...content,
        {
          type: 'finish',
          finishReason: { unified: finishReason, raw: undefined },
          usage: PROVIDER_USAGE,
        },
      ],
    }),
  };
}

function textResponse(text = 'done') {
  return providerResponse(
    [
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: text },
      { type: 'text-end', id: 'answer' },
    ],
    'stop',
  );
}

function scriptedModel(responses: Array<ReturnType<typeof providerResponse>>) {
  let responseIndex = 0;
  return new MockLanguageModelV3({
    provider: 'openai-compatible.test',
    modelId: 'deepseek-chat',
    doStream: () => {
      const response = responses[responseIndex++];
      if (!response) {
        throw new Error(`Missing provider response ${responseIndex}`);
      }
      return Promise.resolve(response);
    },
  });
}

function buildClient(
  model: MockLanguageModelV3,
  {
    overrides,
    stream,
  }: {
    overrides?: Partial<OpenAICompletionsModelClientConfig>;
    stream?: OpenAICompletionsModelClientDependencies['streamText'];
  } = {},
) {
  // The client calls the provider itself; `chatModel` is the real adapter
  // provider's named Chat Completions entry point, and its presence keeps
  // this partial DI stub's shape overlapping the mocked type (a bare
  // callable has no properties in common with `Partial<OpenAICompatibleProvider>`
  // and fails weak-type checking).
  const provider = Object.assign(
    vi.fn(() => model),
    {
      chatModel: vi.fn(() => model),
    },
  );
  createOpenAICompatibleMock.mockReturnValue(provider);
  const config: OpenAICompletionsModelClientConfig = {
    credential: 'sk-test',
    providerModelId: 'deepseek-chat',
    modelId: 'system:deepseek:deepseek-chat',
    contextWindowTokens: 128_000,
    userAgent: USER_AGENT,
    baseUrl: 'https://api.deepseek.com/v1',
    ...overrides,
  };
  return {
    provider,
    client: createOpenAICompletionsModelClient(config, {
      createOpenAICompatible: createOpenAICompatibleMock,
      streamText: stream ?? streamText,
    }),
  };
}

describe('createOpenAICompletionsModelClient — Chat Completions request shape (provider-api-selection)', () => {
  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
    streamTextMock.mockClear();
  });

  it('exposes billing on the built client only when it is configured', () => {
    const model = new MockLanguageModelV3({
      provider: 'openai-compatible.test',
      modelId: 'deepseek-chat',
    });
    const configured = buildClient(model, {
      overrides: { billing: 'usage' },
    }).client;
    const undeclared = buildClient(model).client;

    expect(configured.billing).toBe('usage');
    expect(undeclared).not.toHaveProperty('billing');
  });

  it('builds requests on the Chat Completions model at the provider base URL', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai-compatible.test',
      modelId: 'deepseek-chat',
    });
    streamTextMock.mockReturnValue({});
    const { provider, client } = buildClient(providerModel, {
      stream: streamTextMock,
    });

    client.streamText({ chat: CHAT, messages, system: 'stable system' });

    expect(client).toMatchObject({
      model: 'system:deepseek:deepseek-chat',
      provider: 'openai-completions',
      contextWindowTokens: 128_000,
    });
    // Exact settings, not objectContaining: proves the wire is the adapter's
    // own Chat Completions entry point at the entry's baseUrl, with no
    // Responses-only construction option and no default departure.
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
    });
    expect(provider).toHaveBeenCalledWith('deepseek-chat');
    const streamTextCall = streamTextMock.mock.calls[0]?.[0];
    expect(streamTextCall).toMatchObject({
      model: providerModel,
      messages,
      system: 'stable system',
    });
    expect(streamTextCall?.providerOptions).toBeUndefined();
  });

  it('forwards a configured effort to the adapter as reasoningEffort', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model);

    await expect(
      client.streamText({ chat: CHAT, messages, effort: 'high' }).text,
    ).resolves.toBe('answer');

    // The approved namespace (provider-api-selection D5): the camel-case of
    // the configured provider name, not the adapter's own `openaiCompatible`
    // key. The run's effort arrives as the provider-native token, unchanged.
    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openaiCompletions: { reasoningEffort: 'high' },
    });
  });

  it('lets the run effort outrank an operator reasoningEffort', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: {
        providerOptions: { reasoningEffort: 'low', temperature: 0.5 },
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages, effort: 'high' }).text,
    ).resolves.toBe('answer');

    // Precedence (provider-api-selection): the run's effort wins the shared
    // key while the operator's disjoint key survives beside it.
    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openaiCompletions: { reasoningEffort: 'high', temperature: 0.5 },
    });
  });

  it('sends operator options without an effort under the same namespace', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: {
        providerOptions: { user: 'run-owner', strictJsonSchema: false },
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openaiCompletions: { user: 'run-owner', strictJsonSchema: false },
    });
  });

  it('strips reserved keys before composition and keeps the request whole', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: {
        providerOptions: {
          model: 'smuggled-model',
          max_tokens: 1,
          tool_choice: 'none',
          user: 'run-owner',
        },
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    // The reserved wire seats never reach the composed object; the surviving
    // operator key does, and the request still executes against the entry's
    // own model.
    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openaiCompletions: { user: 'run-owner' },
    });
    expect(model.doStreamCalls[0]?.prompt).toBeDefined();
  });

  it('stays option-free when only reserved keys were configured', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: { providerOptions: { model: 'smuggled-model' } },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    expect(model.doStreamCalls[0]?.providerOptions).toBeUndefined();
  });

  it('forwards unrecognized keys untouched for the adapter to decide', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: {
        providerOptions: { future_option: { nested: [1, 2, 3] } },
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    // No allow-list: llame neither validates nor rewrites the key, so the
    // adapter drops or forwards it under its own ceiling (D5).
    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openaiCompletions: { future_option: { nested: [1, 2, 3] } },
    });
  });

  it('forwards the catalog output limit as the streaming maxOutputTokens setting', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: { maxOutputTokens: 4096 },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    // The AI SDK call setting, not a body key: the adapter derives the wire
    // limit from it (D17) — here the Chat Completions adapter's `max_tokens`.
    expect(model.doStreamCalls[0]?.maxOutputTokens).toBe(4096);
  });

  it('omits the streaming output limit the catalog did not declare', () => {
    const model = new MockLanguageModelV3({
      provider: 'openai-compatible.test',
      modelId: 'deepseek-chat',
    });
    streamTextMock.mockReturnValue({});
    const { client } = buildClient(model, { stream: streamTextMock });

    client.streamText({ chat: CHAT, messages });

    // The AI SDK materializes `maxOutputTokens` (undefined) into every call
    // setting it builds for the adapter, so `doStreamCalls` can never show
    // the key's absence; the omission is observable on the settings object
    // this client hands to `streamText`, which is what the assertion pins.
    expect(streamTextMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'maxOutputTokens',
    );
  });

  it('omits pricing and compaction keys the operator did not configure', () => {
    const { client } = buildClient(
      new MockLanguageModelV3({
        provider: 'openai-compatible.test',
        modelId: 'deepseek-chat',
      }),
    );

    expect(client).not.toHaveProperty('pricing');
    expect(client).not.toHaveProperty('compactionThresholdTokens');
    expect(client.contextWindowTokens).toBe(128_000);
  });

  it('carries configured pricing and compaction metadata through', () => {
    const { client } = buildClient(
      new MockLanguageModelV3({
        provider: 'openai-compatible.test',
        modelId: 'deepseek-chat',
      }),
      {
        overrides: {
          pricing: { inputUsdPer1M: 1, outputUsdPer1M: 2 },
          compactionThresholdTokens: 4000,
        },
      },
    );

    expect(client.pricing).toStrictEqual({
      inputUsdPer1M: 1,
      outputUsdPer1M: 2,
    });
    expect(client.compactionThresholdTokens).toBe(4000);
  });
});

describe('createOpenAICompletionsModelClient — keyless provider', () => {
  beforeEach(() => {
    createOpenAICompatibleMock.mockClear();
  });

  it('passes the keyless placeholder credential instead of omitting the api key', () => {
    const { client } = buildClient(
      new MockLanguageModelV3({
        provider: 'openai-compatible.test',
        modelId: 'llama-local',
      }),
      { overrides: { credential: undefined } },
    );

    expect(client).toMatchObject({ model: 'system:deepseek:deepseek-chat' });
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: KEYLESS_PLACEHOLDER_API_KEY,
    });
  });

  it('constructs a keyless provider without a missing-credential error', () => {
    // Unmocked construction: our code plus the real
    // `@ai-sdk/openai-compatible` factory, no network involved at
    // construction time. This is what proves the endpoint client can be
    // built for a genuinely keyless local server (#162's class of failure
    // was a construction-time credential throw, not a request-time 401).
    const client = createOpenAICompletionsModelClient({
      providerModelId: 'llama-local',
      modelId: 'system:local:llama-local',
      contextWindowTokens: 32_000,
      userAgent: USER_AGENT,
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(client).toMatchObject({
      model: 'system:local:llama-local',
      provider: 'openai-completions',
      contextWindowTokens: 32_000,
    });
  });
});

describe('createOpenAICompletionsModelClient — structured output (design D4)', () => {
  /** The provider's forced tool call answering the `chat_title` schema. */
  function structuredModel() {
    return new MockLanguageModelV3({
      provider: 'openai-compatible.test',
      modelId: 'deepseek-chat',
      doGenerate: () =>
        Promise.resolve({
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-0',
              toolName: 'chat_title',
              input: '{"title":"A title"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: PROVIDER_USAGE,
          warnings: [],
        }),
    });
  }

  /** One structured generation through a scripted model, returning the call
   * the adapter's model received. */
  async function generateTitle(
    overrides: Partial<OpenAICompletionsModelClientConfig> = {},
  ) {
    const model = structuredModel();
    const { provider, client } = buildClient(model, { overrides });
    const generateObject = <OBJECT>(
      input: ModelObjectInput<OBJECT>,
    ): Promise<OBJECT> => {
      if (!client.generateObject) {
        throw new Error(
          'the completions model client must expose generateObject',
        );
      }
      return client.generateObject(input);
    };

    await expect(
      generateObject({
        chat: CHAT,
        messages,
        schemaName: 'chat_title',
        schema: z.object({ title: z.string() }),
      }),
    ).resolves.toEqual({ title: 'A title' });
    return { provider, generateCall: model.doGenerateCalls[0] };
  }

  it('runs forced-tool structured generation on the Chat Completions model', async () => {
    const { provider, generateCall } = await generateTitle();

    expect(provider).toHaveBeenCalledWith('deepseek-chat');
    expect(generateCall?.toolChoice).toEqual({
      type: 'tool',
      toolName: 'chat_title',
    });
    expect(generateCall?.tools).toEqual([
      expect.objectContaining({ name: 'chat_title' }),
    ]);
    // An entry that configures no options keeps this path's option-free
    // request: no `providerOptions` key at all (provider-api-selection).
    expect(generateCall?.providerOptions).toBeUndefined();
  });

  it("carries the operator's options under the wire's namespace", async () => {
    const { generateCall } = await generateTitle({
      providerOptions: { user: 'run-owner', strictJsonSchema: false },
    });

    // The entry's providerOptions reach structured generation under the same
    // namespace streaming uses (provider-api-selection: every language-model
    // request carries them); no effort layer applies to this path.
    expect(generateCall?.providerOptions).toEqual({
      openaiCompletions: { user: 'run-owner', strictJsonSchema: false },
    });
  });

  it('strips reserved keys from the structured request and keeps the forced choice', async () => {
    const { generateCall } = await generateTitle({
      providerOptions: {
        model: 'smuggled-model',
        max_tokens: 1,
        tool_choice: 'none',
        user: 'run-owner',
      },
    });

    // The reserved wire seats never reach the composed object, so the request
    // still runs llame's forced tool choice on the entry's own model.
    expect(generateCall?.providerOptions).toEqual({
      openaiCompletions: { user: 'run-owner' },
    });
    expect(generateCall?.toolChoice).toEqual({
      type: 'tool',
      toolName: 'chat_title',
    });
  });

  it('forwards the catalog output limit on structured generation', async () => {
    const { generateCall } = await generateTitle({ maxOutputTokens: 2048 });

    // Structured generation shares the catalog limit (provider-api-selection
    // D17): same setting the streaming path forwards, observed on the call
    // the adapter's model received.
    expect(generateCall?.maxOutputTokens).toBe(2048);
  });

  it("keeps llame's token leading the value on the forced-tool structured request (design D6)", async () => {
    const { generateCall } = await generateTitle({
      userAgent: 'llame/9.9.9-canary',
    });

    // The AI SDK gives this path its own `ai/<version>` User-Agent, which
    // replaces a provider-level header: llame's per-call token leads the value
    // instead, with the SDK's token following it.
    expect(generateCall?.headers?.['user-agent']).toMatch(
      /^llame\/9\.9\.9-canary ai\//,
    );
  });

  it("renders the configured session header from the request's Chat (design D3)", async () => {
    const { generateCall } = await generateTitle({
      sessionHeader: (chat) => ({
        name: 'x-test-session',
        value: `${chat.lane}:${chat.id}`,
      }),
    });

    // The renderer names one header and reads the request's own Chat identity,
    // so the structured path — the one every title generation takes — carries
    // the identity beside llame's token instead of dropping it.
    expect(generateCall?.headers).toMatchObject({
      'x-test-session': `main:${CHAT.id}`,
    });
    expect(generateCall?.headers?.['user-agent']).toMatch(
      /^llame\/0\.0\.0-test( |$)/,
    );
  });
});

describe("createOpenAICompletionsModelClient — llame's product identity (design D6)", () => {
  it("carries the configured token on the streaming request's user-agent", async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          [
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      // The REAL `@ai-sdk/openai-compatible` adapter and the real `streamText`
      // — only the transport is stubbed, so the assertion reads the request
      // the SDK serialized.
      const client = createOpenAICompletionsModelClient({
        credential: 'sk-test',
        providerModelId: 'deepseek-chat',
        modelId: 'system:deepseek:deepseek-chat',
        contextWindowTokens: 128_000,
        baseUrl: 'https://api.deepseek.com/v1',
        userAgent: 'llame/9.9.9-canary',
      });

      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('done');

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.deepseek.com/v1/chat/completions',
      );
      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(new Headers(init?.headers).get('user-agent')).toMatch(
        /^llame\/9\.9\.9-canary( |$)/,
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('createOpenAICompletionsModelClient — configured provider name (design D2)', () => {
  it("composes the operator's options under the namespace the adapter derives from that name", async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: {
        provider: 'acme-wire',
        providerOptions: { user: 'run-owner' },
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    // The name reaches the adapter factory and is what the client reports,
    // and the options namespace follows it: the adapter camel-cases the
    // configured name (`acme-wire` -> `acmeWire`) and reads the record under
    // that key, so a hardcoded `openaiCompletions` would drop them.
    expect(client.provider).toBe('acme-wire');
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: 'acme-wire',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
    });
    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      acmeWire: { user: 'run-owner' },
    });
  });

  it("renders the configured session header from the request's Chat on the streaming path (design D3)", async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model, {
      overrides: {
        sessionHeader: (chat) => ({
          name: 'x-test-session',
          value: `${chat.lane}:${chat.id}`,
        }),
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('answer');

    expect(model.doStreamCalls[0]?.headers).toMatchObject({
      'x-test-session': `main:${CHAT.id}`,
      'user-agent': USER_AGENT,
    });
  });
});

describe('createOpenAICompletionsModelClient — no provider override and no renderer configured (design D2/D3)', () => {
  it('sends the requests it sent before this layer, on both language-model paths', async () => {
    const previousFetch = globalThis.fetch;
    try {
      // The REAL adapter and the real SDK, only the transport stubbed: every
      // header key here is one llame sends, so an added session header — or
      // any other transport addition — fails this test.
      globalThis.fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          new Response(
            [
              'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
              'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
              'data: [DONE]\n\n',
            ].join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        );
      const client = createOpenAICompletionsModelClient({
        credential: 'sk-test',
        providerModelId: 'deepseek-chat',
        modelId: 'system:deepseek:deepseek-chat',
        contextWindowTokens: 128_000,
        baseUrl: 'https://api.deepseek.com/v1',
        userAgent: USER_AGENT,
      });

      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('done');

      const streamingInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
      expect([...new Headers(streamingInit?.headers).keys()].sort()).toEqual([
        'authorization',
        'content-type',
        'user-agent',
      ]);

      globalThis.fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 0,
            model: 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: {
                        name: 'chat_title',
                        arguments: '{"title":"A title"}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );

      const object = await client.generateObject?.({
        chat: CHAT,
        messages,
        schemaName: 'chat_title',
        schema: z.object({ title: z.string() }),
      });

      expect(object).toEqual({ title: 'A title' });
      const structuredInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
      expect([...new Headers(structuredInit?.headers).keys()].sort()).toEqual([
        'authorization',
        'content-type',
        'user-agent',
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('createOpenAICompletionsModelClient — reasoning deltas and the tool loop (reasoning-output)', () => {
  const tools = {
    echo: tool({
      inputSchema: z.strictObject({ value: z.string() }),
      execute: ({ value }) => value,
    }),
  };

  it('forwards normalized reasoning deltas across a multi-step exchange', async () => {
    const model = scriptedModel([
      providerResponse(
        [
          { type: 'reasoning-start', id: 'reasoning-0' },
          { type: 'reasoning-delta', id: 'reasoning-0', delta: 'looking up' },
          { type: 'reasoning-end', id: 'reasoning-0' },
          {
            type: 'tool-call',
            toolCallId: 'call-0',
            toolName: 'echo',
            input: '{"value":"first"}',
          },
        ],
        'tool-calls',
      ),
      providerResponse(
        [
          { type: 'reasoning-start', id: 'reasoning-0' },
          { type: 'reasoning-delta', id: 'reasoning-0', delta: 'found it' },
          { type: 'reasoning-end', id: 'reasoning-0' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'done' },
          { type: 'text-end', id: 'answer' },
        ],
        'stop',
      ),
    ]);
    const { client } = buildClient(model);
    const onTextDelta = vi.fn();
    const onReasoningDelta = vi.fn();

    await expect(
      client.streamText({
        chat: CHAT,
        messages,
        tools,
        maxSteps: 2,
        onTextDelta,
        onReasoningDelta,
      }).text,
    ).resolves.toBe('done');

    // Exact call lists, not `toHaveBeenCalledWith`: each normalized delta
    // must reach its own callback exactly once, so a chunk routed to both
    // cannot pass. The constant adapter id rides along (D8).
    expect(onTextDelta.mock.calls).toEqual([['done']]);
    expect(onReasoningDelta.mock.calls).toEqual([
      ['looking up', 'reasoning-0'],
      ['found it', 'reasoning-0'],
    ]);
    expect(model.doStreamCalls).toHaveLength(2);
    // The follow-up request of the same turn carries the prior assistant
    // reasoning for the adapter to re-inject as `reasoning_content` (D5/D15);
    // llame adds no request field of its own.
    const followUpAssistant = model.doStreamCalls[1]?.prompt.find(
      (message) => message.role === 'assistant',
    );
    const replayedReasoning = Array.isArray(followUpAssistant?.content)
      ? followUpAssistant.content.filter((part) => part.type === 'reasoning')
      : [];
    expect(replayedReasoning).toEqual([
      { type: 'reasoning', text: 'looking up' },
    ]);
  });

  it('completes normally when the response carries no reasoning', async () => {
    const model = scriptedModel([textResponse('answer')]);
    const { client } = buildClient(model);
    const onReasoningDelta = vi.fn();

    await expect(
      client.streamText({ chat: CHAT, messages, onReasoningDelta }).text,
    ).resolves.toBe('answer');

    expect(onReasoningDelta).not.toHaveBeenCalled();
  });
});
