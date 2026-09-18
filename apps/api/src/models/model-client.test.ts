import type { ModelMessage } from 'ai';
import type { streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { createOpenAI } from '@ai-sdk/openai';

import {
  MissingModelCredentialError,
  resolveModelCredential,
} from './model-client';
import {
  createOpenAIModelClient,
  KEYLESS_PLACEHOLDER_API_KEY,
} from './openai-model-client';

// Test seam (anti-slop/no-module-mocking): these tests verify how
// createOpenAIModelClient SHAPES its calls into the AI SDK's provider
// factory and streamText — not the SDK's own streaming behavior (that's
// openai-model-client.tools.test.ts, via MockLanguageModelV3 + real
// streamText) — so streamText itself must be observable here, not just the
// language model layer beneath it.
const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
  partial: true,
});
const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
  partial: true,
});

const messages = [
  {
    role: 'user',
    content: 'Hello',
  },
] satisfies Array<ModelMessage>;

/**
 * The Responses client calls the provider itself (its Responses entry
 * point). The named `responses` member is never invoked, but a bare callable
 * has no properties in common with the `Partial<OpenAIProvider>` the partial
 * DI mock accepts, so the stub carries it to stay assignable.
 */
function responsesProviderMock(model: MockLanguageModelV3) {
  return Object.assign(
    vi.fn(() => model),
    {
      responses: vi.fn(() => model),
    },
  );
}

describe('ModelClient', () => {
  beforeEach(() => {
    createOpenAIMock.mockReset();
    streamTextMock.mockReset();
  });

  it('fails closed with a typed error when no user credential is available', async () => {
    await expect(resolveModelCredential('user-1')).rejects.toMatchObject({
      name: 'MissingModelCredentialError',
      code: 'missing_model_credential',
      userId: 'user-1',
    });

    await expect(resolveModelCredential('user-1')).rejects.toBeInstanceOf(
      MissingModelCredentialError,
    );
  });

  it('constructs a per-request client from a user-supplied credential', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    // The Responses client calls the provider itself (openai(model)) — its
    // Responses entry point. No Chat Completions path exists here.
    const openaiProvider = responsesProviderMock(providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const credential = await resolveModelCredential('user-1', (userId) =>
      userId === 'user-1' ? 'sk-user-supplied' : null,
    );
    const client = createOpenAIModelClient(
      {
        credential,
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    const abortSignal = AbortSignal.timeout(1000);
    const onError = vi.fn();
    const onFinish = vi.fn();
    client.streamText({
      messages,
      system: 'stable system',
      abortSignal,
      onError,
      onFinish,
    });

    expect(client).toMatchObject({
      model: 'system:openai:gpt-test',
      provider: 'openai',
    });
    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: 'sk-user-supplied',
    });
    expect(openaiProvider).toHaveBeenCalledWith('gpt-test');
    const streamTextCall = streamTextMock.mock.calls[0]?.[0];
    expect(streamTextCall).toMatchObject({
      model: providerModel,
      messages,
      system: 'stable system',
      abortSignal,
      onError,
      onFinish,
    });
    expect(streamTextCall?.onAbort).toEqual(expect.any(Function));
  });

  it('passes a non-empty placeholder apiKey for a keyless provider (#162)', () => {
    // Omitting `apiKey` entirely (rather than a placeholder) is what made
    // @ai-sdk/provider-utils's loadApiKey throw LoadAPIKeyError for a
    // genuinely keyless endpoint (local Ollama) when OPENAI_API_KEY was also
    // unset — see the unmocked regression test below, which is what actually
    // proves loadApiKey doesn't throw; this test only proves OUR code passes
    // the right constructor args.
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-local',
    });
    const openaiProvider = responsesProviderMock(providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const client = createOpenAIModelClient(
      {
        providerModelId: 'gpt-local',
        modelId: 'system:local:gpt-local',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );
    client.streamText({ messages });

    expect(client).toMatchObject({
      model: 'system:local:gpt-local',
      provider: 'openai',
    });
    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: KEYLESS_PLACEHOLDER_API_KEY,
    });
    expect(openaiProvider).toHaveBeenCalledWith('gpt-local');
    const streamTextCall = streamTextMock.mock.calls[0]?.[0];
    expect(streamTextCall).toMatchObject({
      model: providerModel,
      messages,
      system: undefined,
      abortSignal: undefined,
      onError: undefined,
      onFinish: undefined,
    });
    expect(streamTextCall?.onAbort).toEqual(expect.any(Function));
  });

  it('targets the configured base URL when one is provided', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    // The Responses wire is served at the entry's baseUrl (design D1).
    const openaiProvider = responsesProviderMock(providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const client = createOpenAIModelClient(
      {
        credential: 'sk-user-supplied',
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
        baseUrl: 'https://openrouter.ai/api/v1',
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );
    client.streamText({ messages });

    expect(client).toMatchObject({
      model: 'system:openai:gpt-test',
      provider: 'openai',
    });
    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: 'sk-user-supplied',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('exposes configured pricing and compaction metadata on the model client', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const openaiProvider = responsesProviderMock(providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const pricing = {
      inputUsdPer1M: 1,
      cachedInputUsdPer1M: 0.25,
      outputUsdPer1M: 4,
    };
    const client = createOpenAIModelClient(
      {
        credential: 'sk-user-supplied',
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
        pricing,
        compactionThresholdTokens: 64_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    expect(client).toMatchObject({
      pricing,
      compactionThresholdTokens: 64_000,
    });
  });

  it('uses the Responses wire with an automatic displayable reasoning summary', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const openaiProvider = responsesProviderMock(providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const client = createOpenAIModelClient(
      {
        credential: 'sk-user-supplied',
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );
    client.streamText({ messages });

    expect(openaiProvider).toHaveBeenCalledWith('gpt-test');
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: providerModel,
        providerOptions: { openai: { reasoningSummary: 'auto' } },
      }),
    );
  });

  it('forwards the adapter reasoning part id with each reasoning delta', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const openaiProvider = responsesProviderMock(providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const onReasoningDelta = vi.fn();
    const client = createOpenAIModelClient(
      {
        credential: 'sk-user-supplied',
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );
    client.streamText({ messages, onReasoningDelta });

    // The SDK's `reasoning-delta` chunk carries the part id
    // (`${itemId}:${summaryIndex}` on Responses); the seam must not drop it.
    const onChunk = streamTextMock.mock.calls[0]?.[0]?.onChunk;
    expect(onChunk).toBeTypeOf('function');
    onChunk?.({
      chunk: {
        type: 'reasoning-delta',
        id: 'rs_1:0',
        text: '**Investigating**',
      },
    });

    expect(onReasoningDelta).toHaveBeenCalledWith(
      '**Investigating**',
      'rs_1:0',
    );
  });

  describe('reasoning effort (add-reasoning-effort)', () => {
    function build() {
      const providerModel = new MockLanguageModelV3({
        provider: 'openai.responses',
        modelId: 'gpt-test',
      });
      const openaiProvider = responsesProviderMock(providerModel);
      createOpenAIMock.mockReturnValue(openaiProvider);
      streamTextMock.mockReturnValue({});
      return createOpenAIModelClient(
        {
          credential: 'sk-user-supplied',
          providerModelId: 'gpt-test',
          modelId: 'system:openai:gpt-test',
          contextWindowTokens: 128_000,
        },
        { createOpenAI: createOpenAIMock, streamText: streamTextMock },
      );
    }

    // One property, two data points: an ordinary level and a token carrying
    // casing/separators llame never constrains. Both must reach the provider
    // byte-for-byte on the Responses wire.
    it.each(['xhigh', 'Very-High_2'])(
      'sends %s through the Responses wire verbatim',
      (effort) => {
        build().streamText({ messages, effort });

        expect(streamTextMock).toHaveBeenCalledWith(
          expect.objectContaining({
            providerOptions: {
              openai: { reasoningSummary: 'auto', reasoningEffort: effort },
            },
          }),
        );
      },
    );

    it('sends the effort alongside the automatic reasoning summary, not instead of it', () => {
      build().streamText({ messages, effort: 'max' });

      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: {
            openai: { reasoningSummary: 'auto', reasoningEffort: 'max' },
          },
        }),
      );
    });

    // Presence, never truthiness: a level meaning "do not reason" is a real
    // instruction to the provider, and dropping it would silently fall back to
    // the provider's own default instead.
    it('sends a level denoting disabled reasoning rather than dropping it', () => {
      build().streamText({ messages, effort: 'none' });

      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: {
            openai: { reasoningSummary: 'auto', reasoningEffort: 'none' },
          },
        }),
      );
    });
  });
});
