import type { ModelMessage } from 'ai';
import { streamText } from 'ai';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';

import { createFakeModelClient } from './fake-model-client';
import {
  MissingModelCredentialError,
  resolveModelCredential,
} from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(),
}));

jest.mock('ai', () => ({
  streamText: jest.fn(),
}));

const createOpenAIMock = jest.mocked(createOpenAI);
const streamTextMock = jest.mocked(streamText);

async function collectText(stream: AsyncIterable<string>): Promise<string> {
  let text = '';

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}

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
    const providerModel = { provider: 'openai', modelId: 'gpt-test' };
    const openaiProvider = jest.fn(() => providerModel);
    // The client uses the /chat/completions API (OpenAI-compatible, #88).
    (openaiProvider as unknown as { chat: unknown }).chat = openaiProvider;
    createOpenAIMock.mockReturnValue(
      openaiProvider as unknown as OpenAIProvider,
    );
    streamTextMock.mockReturnValue({
      textStream: (async function* () {})(),
    } as unknown as ReturnType<typeof streamText>);

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
    const onError = jest.fn();
    const onFinish = jest.fn();
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
    expect(streamTextMock).toHaveBeenCalledWith({
      model: providerModel,
      messages,
      system: 'stable system',
      abortSignal,
      onError,
      onFinish,
    });
  });

  it('can create the provider client without an API key for keyless compatible endpoints', () => {
    const providerModel = {
      provider: 'openai',
      modelId: 'gpt-local',
    };
    const openaiProvider = jest.fn(() => providerModel);
    (openaiProvider as unknown as { chat: unknown }).chat = openaiProvider;
    createOpenAIMock.mockReturnValue(
      openaiProvider as unknown as OpenAIProvider,
    );
    streamTextMock.mockReturnValue({
      textStream: (async function* () {})(),
    } as unknown as ReturnType<typeof streamText>);

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
    expect(createOpenAIMock).toHaveBeenCalledWith({});
    expect(openaiProvider).toHaveBeenCalledWith('gpt-local');
    expect(streamTextMock).toHaveBeenCalledWith({
      model: providerModel,
      messages,
      system: undefined,
      abortSignal: undefined,
      onError: undefined,
      onFinish: undefined,
    });
  });

  it('targets an OpenAI-compatible endpoint when a base URL is provided', () => {
    const providerModel = { provider: 'openai', modelId: 'gpt-test' };
    const openaiProvider = jest.fn(() => providerModel);
    // The client uses the /chat/completions API (OpenAI-compatible, #88).
    (openaiProvider as unknown as { chat: unknown }).chat = openaiProvider;
    createOpenAIMock.mockReturnValue(
      openaiProvider as unknown as OpenAIProvider,
    );
    streamTextMock.mockReturnValue({
      textStream: (async function* () {})(),
    } as unknown as ReturnType<typeof streamText>);

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

  it('passes onFinish through to the fake client', async () => {
    const client = createFakeModelClient(['done']);
    const onFinish = jest.fn();

    await collectText(client.streamText({ messages, onFinish }).textStream);

    expect(client).toMatchObject({ model: 'fake-model', provider: 'fake' });
    expect(onFinish).toHaveBeenCalledWith({
      text: 'done',
      usage: {
        inputTokens: 0,
        inputTokenDetails: {
          noCacheTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 0,
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        totalTokens: 0,
      },
      finishReason: 'stop',
    });
  });

  it('uses a fake client to drive callers without a provider or network', async () => {
    const client = createFakeModelClient(['first', 'second']);

    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe('first');
    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe('second');
    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe('first');
  });
});
