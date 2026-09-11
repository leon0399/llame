import type { createOpenAIModelClient } from './openai-model-client';
import type { createOpenAICodexModelClient } from './openai-codex-model-client';
import { createModelClient } from './model-client-factory';

// Test seam (anti-slop/no-module-mocking): overrides createOpenAIModelClient
// via createModelClient's own dependency-injection param instead of
// module-mocking ./openai-model-client — this suite only verifies routing
// (which provider-derived args createModelClient constructs), not the real
// client's behavior.
const createOpenAIModelClientMock = vi.mocked(
  vi.fn<typeof createOpenAIModelClient>(),
  { partial: true },
);
createOpenAIModelClientMock.mockReturnValue({ model: 'fake' });

const createOpenAICodexModelClientMock = vi.mocked(
  vi.fn<typeof createOpenAICodexModelClient>(),
  { partial: true },
);
createOpenAICodexModelClientMock.mockReturnValue({ model: 'fake' });

const model = {
  id: 'system:test:model',
  source: 'system' as const,
  providerModelId: 'model',
  provider: 'provider',
  displayName: 'Model',
  contextWindowTokens: 128_000,
  systemPromptTemplate: 'Test prompt',
  systemPromptSource: 'project_default' as const,
};

describe('createModelClient native OpenAI routing', () => {
  beforeEach(() => {
    createOpenAIModelClientMock.mockClear();
    createOpenAICodexModelClientMock.mockClear();
  });

  it('routes any Codex provider id to the fixed subscription transport', () => {
    createModelClient(
      {
        provider: {
          id: 'personal-codex',
          type: 'openai-codex',
          key: 'access-token',
          accountId: 'account-id',
        },
        model: { ...model, provider: 'personal-codex' },
      },
      {
        createOpenAIModelClient: createOpenAIModelClientMock,
        createOpenAICodexModelClient: createOpenAICodexModelClientMock,
      },
    );

    expect(createOpenAICodexModelClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'model',
      }),
    );
    expect(createOpenAIModelClientMock).not.toHaveBeenCalled();
  });

  it('uses the native Responses path only for the configured openai provider id', () => {
    createModelClient(
      {
        provider: { id: 'openai', type: 'openai', key: 'key', baseUrl: null },
        model,
      },
      { createOpenAIModelClient: createOpenAIModelClientMock },
    );

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ nativeOpenAI: true }),
    );
  });

  it.each(['openrouter', 'huggingface', 'custom-compatible'])(
    'keeps %s on the compatible Chat Completions path',
    (id) => {
      createModelClient(
        {
          provider: {
            id,
            type: 'openai',
            key: 'key',
            baseUrl: 'https://example.test/v1',
          },
          model: { ...model, provider: id },
        },
        { createOpenAIModelClient: createOpenAIModelClientMock },
      );

      expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
        expect.objectContaining({ nativeOpenAI: false }),
      );
    },
  );
});
