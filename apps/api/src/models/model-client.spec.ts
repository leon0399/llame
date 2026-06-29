import type { ModelMessage } from 'ai';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { createFakeModelClient } from './fake-model-client';
import {
  MissingModelCredentialError,
  resolveModelCredential,
} from './model-client';
import {
  DEFAULT_OPENAI_MODEL,
  createOpenAIModelClient,
} from './openai-model-client';

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
    createOpenAIMock.mockReturnValue(
      openaiProvider as unknown as ReturnType<typeof createOpenAI>,
    );
    streamTextMock.mockReturnValue({
      textStream: (function* () {})(),
    } as unknown as ReturnType<typeof streamText>);

    const credential = await resolveModelCredential('user-1', (userId) =>
      userId === 'user-1' ? 'sk-user-supplied' : null,
    );
    const client = createOpenAIModelClient(credential, 'gpt-test');

    const abortSignal = AbortSignal.timeout(1000);
    client.streamText({
      messages,
      system: 'stable system',
      abortSignal,
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
    });
  });

  it('can create the provider client directly with the default model', () => {
    const providerModel = {
      provider: 'openai',
      modelId: DEFAULT_OPENAI_MODEL,
    };
    const openaiProvider = jest.fn(() => providerModel);
    createOpenAIMock.mockReturnValue(
      openaiProvider as unknown as ReturnType<typeof createOpenAI>,
    );
    streamTextMock.mockReturnValue({
      textStream: (function* () {})(),
    } as unknown as ReturnType<typeof streamText>);

    createOpenAIModelClient('sk-user-supplied').streamText({ messages });

    expect(openaiProvider).toHaveBeenCalledWith(DEFAULT_OPENAI_MODEL);
    expect(streamTextMock).toHaveBeenCalledWith({
      model: providerModel,
      messages,
      system: undefined,
      abortSignal: undefined,
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
