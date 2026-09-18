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

import { type ModelObjectInput } from './model-client';
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

  it('builds requests on the Chat Completions model at the provider base URL', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai-compatible.test',
      modelId: 'deepseek-chat',
    });
    streamTextMock.mockReturnValue({});
    const { provider, client } = buildClient(providerModel, {
      stream: streamTextMock,
    });

    client.streamText({ messages, system: 'stable system' });

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
      client.streamText({ messages, effort: 'high' }).text,
    ).resolves.toBe('answer');

    // The request the adapter's model is called with: the provider-native
    // token unchanged, under the adapter's non-deprecated `openaiCompatible`
    // option key.
    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openaiCompatible: { reasoningEffort: 'high' },
    });
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
  it('runs forced-tool structured generation on the Chat Completions model', async () => {
    const model = new MockLanguageModelV3({
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
    const { provider, client } = buildClient(model);
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
        messages,
        schemaName: 'chat_title',
        schema: z.object({ title: z.string() }),
      }),
    ).resolves.toEqual({ title: 'A title' });

    expect(provider).toHaveBeenCalledWith('deepseek-chat');
    expect(model.doGenerateCalls[0]?.toolChoice).toEqual({
      type: 'tool',
      toolName: 'chat_title',
    });
    expect(model.doGenerateCalls[0]?.tools).toEqual([
      expect.objectContaining({ name: 'chat_title' }),
    ]);
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
      client.streamText({ messages, onReasoningDelta }).text,
    ).resolves.toBe('answer');

    expect(onReasoningDelta).not.toHaveBeenCalled();
  });
});
