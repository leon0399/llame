import type { ModelMessage } from 'ai';
import { streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createOpenAI } from '@ai-sdk/openai';

import {
  MissingModelCredentialError,
  resolveModelCredential,
} from './model-client';
import {
  createOpenAIModelClient,
  KEYLESS_PLACEHOLDER_API_KEY,
} from './openai-model-client';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(),
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

const createOpenAIMock = vi.mocked(createOpenAI, { partial: true });
const streamTextMock = vi.mocked(streamText, { partial: true });

const messages = [
  {
    role: 'user',
    content: 'Hello',
  },
] satisfies ModelMessage[];

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
      provider: 'openai.chat',
      modelId: 'gpt-test',
    });
    // The client uses the /chat/completions API (OpenAI-compatible, #88).
    const openaiProvider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const credential = await resolveModelCredential('user-1', (userId) =>
      userId === 'user-1' ? 'sk-user-supplied' : null,
    );
    const client = createOpenAIModelClient({
      credential,
      providerModelId: 'gpt-test',
      modelId: 'system:openai:gpt-test',
      contextWindowTokens: 128_000,
    });

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
    expect(openaiProvider.chat).toHaveBeenCalledWith('gpt-test');
    const streamTextCall = streamTextMock.mock.calls[0]?.[0];
    expect(streamTextCall).toMatchObject({
      model: providerModel,
      messages,
      system: 'stable system',
      abortSignal,
      onError,
      onFinish,
    });
    expect(typeof streamTextCall?.onAbort).toBe('function');
  });

  it('passes a non-empty placeholder apiKey for keyless compatible endpoints (#162)', () => {
    // Omitting `apiKey` entirely (rather than a placeholder) is what made
    // @ai-sdk/provider-utils's loadApiKey throw LoadAPIKeyError for a
    // genuinely keyless endpoint (local Ollama) when OPENAI_API_KEY was also
    // unset — see the unmocked regression test below, which is what actually
    // proves loadApiKey doesn't throw; this test only proves OUR code passes
    // the right constructor args.
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.chat',
      modelId: 'gpt-local',
    });
    const openaiProvider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const client = createOpenAIModelClient({
      providerModelId: 'gpt-local',
      modelId: 'system:local:gpt-local',
      contextWindowTokens: 128_000,
    });
    client.streamText({ messages });

    expect(client).toMatchObject({
      model: 'system:local:gpt-local',
      provider: 'openai',
    });
    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: KEYLESS_PLACEHOLDER_API_KEY,
    });
    expect(openaiProvider.chat).toHaveBeenCalledWith('gpt-local');
    const streamTextCall = streamTextMock.mock.calls[0]?.[0];
    expect(streamTextCall).toMatchObject({
      model: providerModel,
      messages,
      system: undefined,
      abortSignal: undefined,
      onError: undefined,
      onFinish: undefined,
    });
    expect(typeof streamTextCall?.onAbort).toBe('function');
  });

  it('targets an OpenAI-compatible endpoint when a base URL is provided', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.chat',
      modelId: 'gpt-test',
    });
    // The client uses the /chat/completions API (OpenAI-compatible, #88).
    const openaiProvider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const client = createOpenAIModelClient({
      credential: 'sk-user-supplied',
      providerModelId: 'gpt-test',
      modelId: 'system:openai:gpt-test',
      contextWindowTokens: 128_000,
      baseUrl: 'https://openrouter.ai/api/v1',
    });
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

  it('uses native Responses with an automatic displayable reasoning summary when configured for native OpenAI', () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const openaiProvider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({});

    const client = createOpenAIModelClient({
      credential: 'sk-user-supplied',
      providerModelId: 'gpt-test',
      modelId: 'system:openai:gpt-test',
      contextWindowTokens: 128_000,
      nativeOpenAI: true,
    });
    client.streamText({ messages });

    expect(openaiProvider).toHaveBeenCalledWith('gpt-test');
    expect(openaiProvider.chat).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: providerModel,
        providerOptions: { openai: { reasoningSummary: 'auto' } },
      }),
    );
  });
});
