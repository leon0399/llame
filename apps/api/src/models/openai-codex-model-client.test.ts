import type { ModelMessage, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { createOpenAI } from '@ai-sdk/openai';

import {
  CODEX_RESPONSES_BASE_URL,
  createOpenAICodexModelClient,
} from './openai-codex-model-client';

const messages = [
  { role: 'user', content: 'Use the configured transport.' },
] satisfies Array<ModelMessage>;

describe('createOpenAICodexModelClient', () => {
  it('uses the fixed Responses transport with private subscription headers and no remote storage', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const chat = vi.fn(() => providerModel);
    const provider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat,
      },
    );
    const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
      partial: true,
    });
    createOpenAIMock.mockReturnValue(provider);
    const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
      partial: true,
    });
    streamTextMock.mockReturnValue({});
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 302 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient(
        {
          credential: 'access-token',
          accountId: 'account-id',
          providerModelId: 'gpt-test',
          modelId: 'system:codex:gpt-test',
          contextWindowTokens: 128_000,
        },
        { createOpenAI: createOpenAIMock, streamText: streamTextMock },
      );

      client.streamText({ messages, effort: 'high' });

      expect(client).toMatchObject({
        model: 'system:codex:gpt-test',
        provider: 'openai-codex',
      });
      expect('generateObject' in client).toBe(false);
      expect(createOpenAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'access-token',
          baseURL: CODEX_RESPONSES_BASE_URL,
          headers: {
            'ChatGPT-Account-ID': 'account-id',
            Accept: 'text/event-stream',
            'OpenAI-Beta': 'responses=experimental',
            Originator: 'llame',
          },
        }),
      );
      expect(provider).toHaveBeenCalledWith('gpt-test');
      expect(chat).not.toHaveBeenCalled();
      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: providerModel,
          providerOptions: {
            openai: {
              reasoningSummary: 'auto',
              reasoningEffort: 'high',
              store: false,
            },
          },
        }),
      );

      const [createOptions] = createOpenAIMock.mock.calls.at(0) ?? [];
      const transportFetch = createOptions?.fetch;
      if (!transportFetch)
        throw new Error('expected a transport fetch wrapper');
      await transportFetch('https://redirect.example.test', {
        redirect: 'follow',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://redirect.example.test',
        expect.objectContaining({ redirect: 'manual' }),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
