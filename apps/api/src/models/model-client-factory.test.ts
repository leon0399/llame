import type {
  OpenAICompletionsProviderConfig,
  OpenAIResponsesProviderConfig,
} from '../instance-config/llame-config';
import type { createOpenAICompletionsModelClient } from './openai-completions-model-client';
import type { createOpenAICodexModelClient } from './openai-codex-model-client';
import type { createOpenAIModelClient } from './openai-model-client';
import { createModelClient } from './model-client-factory';

// Test seam (anti-slop/no-module-mocking): overrides the per-provider client
// constructors via createModelClient's own dependency-injection param instead
// of module-mocking the client modules — this suite only verifies routing
// (which provider-derived args createModelClient constructs and which client
// it selects), not any client's behavior.
const createResponsesClientMock = vi.mocked(
  vi.fn<typeof createOpenAIModelClient>(),
  { partial: true },
);
createResponsesClientMock.mockReturnValue({ model: 'fake' });

const createCompletionsClientMock = vi.mocked(
  vi.fn<typeof createOpenAICompletionsModelClient>(),
  { partial: true },
);
createCompletionsClientMock.mockReturnValue({ model: 'fake' });

const createCodexClientMock = vi.mocked(
  vi.fn<typeof createOpenAICodexModelClient>(),
  { partial: true },
);
createCodexClientMock.mockReturnValue({ model: 'fake' });

const dependencies = {
  createOpenAIModelClient: createResponsesClientMock,
  createOpenAICompletionsModelClient: createCompletionsClientMock,
  createOpenAICodexModelClient: createCodexClientMock,
};

const model = {
  id: 'system:test:model',
  source: 'system' as const,
  providerModelId: 'model',
  provider: 'provider',
  displayName: 'Model',
  contextWindowTokens: 128_000,
  systemPromptTemplate: 'Test prompt',
  systemPromptSource: 'project_default' as const,
  referencesSkills: false,
};

describe('createModelClient wire dispatch', () => {
  beforeEach(() => {
    createResponsesClientMock.mockClear();
    createCompletionsClientMock.mockClear();
    createCodexClientMock.mockClear();
  });

  it('routes an openai-responses provider to the Responses client whatever its id', () => {
    createModelClient(
      {
        provider: {
          id: 'third-party-responses',
          type: 'openai-responses',
          key: 'sk-key',
          baseUrl: null,
        },
        model: { ...model, provider: 'third-party-responses' },
      },
      dependencies,
    );

    expect(createResponsesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'sk-key',
        baseUrl: undefined,
        providerModelId: 'model',
      }),
    );
    expect(createCompletionsClientMock).not.toHaveBeenCalled();
    expect(createCodexClientMock).not.toHaveBeenCalled();
  });

  it('routes an openai-completions provider whose id is openai to the completions client', () => {
    createModelClient(
      {
        provider: {
          id: 'openai',
          type: 'openai-completions',
          key: 'sk-key',
          baseUrl: 'https://api.openai.com/v1',
        },
        model,
      },
      dependencies,
    );

    expect(createCompletionsClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'sk-key',
        baseUrl: 'https://api.openai.com/v1',
        providerModelId: 'model',
      }),
    );
    expect(createResponsesClientMock).not.toHaveBeenCalled();
  });

  it('routes an openai-responses provider pointed at a local host to the Responses client', () => {
    createModelClient(
      {
        provider: {
          id: 'ollama',
          type: 'openai-responses',
          key: null,
          baseUrl: 'http://localhost:11434/v1',
        },
        model: { ...model, provider: 'ollama' },
      },
      dependencies,
    );

    expect(createResponsesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: undefined,
        baseUrl: 'http://localhost:11434/v1',
      }),
    );
    expect(createCompletionsClientMock).not.toHaveBeenCalled();
  });

  it('resolves two providers of one type independently', () => {
    createModelClient(
      {
        provider: {
          id: 'local-ollama',
          type: 'openai-completions',
          key: null,
          baseUrl: 'http://localhost:11434/v1',
        },
        model: { ...model, provider: 'local-ollama' },
      },
      dependencies,
    );
    createModelClient(
      {
        provider: {
          id: 'openrouter',
          type: 'openai-completions',
          key: 'sk-or',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
        model: { ...model, provider: 'openrouter' },
      },
      dependencies,
    );

    expect(createCompletionsClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        credential: undefined,
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'system:test:model',
      }),
    );
    expect(createCompletionsClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        credential: 'sk-or',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'system:test:model',
      }),
    );
  });

  it('routes openai-codex to the fixed subscription transport regardless of id', () => {
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
      dependencies,
    );

    expect(createCodexClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'model',
      }),
    );
    expect(createResponsesClientMock).not.toHaveBeenCalled();
    expect(createCompletionsClientMock).not.toHaveBeenCalled();
  });

  it('selects the client without reading provider.id', () => {
    const responsesProvider: OpenAIResponsesProviderConfig = {
      id: 'openai-responses-unreadable',
      type: 'openai-responses',
      key: 'sk-key',
      baseUrl: null,
    };
    const completionsProvider: OpenAICompletionsProviderConfig = {
      id: 'openai-completions-unreadable',
      type: 'openai-completions',
      key: 'sk-key',
      baseUrl: 'https://api.example.test/v1',
    };
    for (const provider of [responsesProvider, completionsProvider]) {
      Object.defineProperty(provider, 'id', {
        get: () => {
          throw new Error('provider.id must not select the wire');
        },
      });
    }

    createModelClient({ provider: responsesProvider, model }, dependencies);
    createModelClient({ provider: completionsProvider, model }, dependencies);

    expect(createResponsesClientMock).toHaveBeenCalledTimes(1);
    expect(createCompletionsClientMock).toHaveBeenCalledTimes(1);
  });
});
