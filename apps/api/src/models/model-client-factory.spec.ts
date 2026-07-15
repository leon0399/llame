import { createModelClient } from './model-client-factory';
import { createOpenAIModelClient } from './openai-model-client';

jest.mock('./openai-model-client', () => ({
  createOpenAIModelClient: jest.fn(() => ({ model: 'fake' })),
}));

const createOpenAIModelClientMock = jest.mocked(createOpenAIModelClient);
const model = {
  id: 'system:test:model',
  source: 'system' as const,
  providerModelId: 'model',
  provider: 'provider',
  displayName: 'Model',
  contextWindowTokens: 128_000,
};

describe('createModelClient native OpenAI routing', () => {
  beforeEach(() => createOpenAIModelClientMock.mockClear());

  it('uses the native Responses path only for the configured openai provider id', () => {
    createModelClient({
      provider: { id: 'openai', type: 'openai', key: 'key', baseUrl: null },
      model,
    });

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ nativeOpenAI: true }),
    );
  });

  it.each(['openrouter', 'huggingface', 'custom-compatible'])(
    'keeps %s on the compatible Chat Completions path',
    (id) => {
      createModelClient({
        provider: {
          id,
          type: 'openai',
          key: 'key',
          baseUrl: 'https://example.test/v1',
        },
        model: { ...model, provider: id },
      });

      expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
        expect.objectContaining({ nativeOpenAI: false }),
      );
    },
  );
});
