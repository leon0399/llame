import type { createAnthropicModelClient } from './anthropic-model-client';
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

  it('carries the model providerOptions and maxOutputTokens into every client config without mutating the entry', () => {
    const providerOptions = { user: 'run-owner', max_tokens: 1 };
    const entry = {
      ...model,
      providerOptions,
      maxOutputTokens: 4096,
    };

    const providers = [
      {
        id: 'responses-entry',
        type: 'openai-responses',
        key: 'sk-key',
        baseUrl: null,
      },
      {
        id: 'completions-entry',
        type: 'openai-completions',
        key: 'sk-key',
        baseUrl: 'https://api.example.test/v1',
      },
      {
        id: 'codex-entry',
        type: 'openai-codex',
        key: 'access-token',
        accountId: 'account-id',
      },
    ] as const;
    for (const provider of providers) {
      createModelClient(
        { provider, model: { ...entry, provider: provider.id } },
        dependencies,
      );
    }

    // The raw object the catalog entry carried reaches each client, so the
    // clients — not the factory — own namespacing and reserved-key policy;
    // the entry itself is untouched.
    for (const mock of [
      createResponsesClientMock,
      createCompletionsClientMock,
      createCodexClientMock,
    ]) {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions,
          maxOutputTokens: 4096,
        }),
      );
    }
    expect(entry.providerOptions).toBe(providerOptions);
    expect(entry.maxOutputTokens).toBe(4096);
  });

  it('leaves providerOptions and maxOutputTokens absent when the entry declares neither', () => {
    createModelClient(
      {
        provider: {
          id: 'completions-entry',
          type: 'openai-completions',
          key: 'sk-key',
          baseUrl: 'https://api.example.test/v1',
        },
        model,
      },
      dependencies,
    );

    // No-options regression guard: the pre-change configs carried no such
    // keys, so an entry without them still sends none.
    const config = createCompletionsClientMock.mock.calls[0]?.[0];
    expect(config).not.toHaveProperty('providerOptions');
    expect(config).not.toHaveProperty('maxOutputTokens');
  });
});
describe('createModelClient anthropic-messages dispatch (anthropic-provider 3.2)', () => {
  const createMessagesClientMock = vi.mocked(
    vi.fn<typeof createAnthropicModelClient>(),
    { partial: true },
  );
  createMessagesClientMock.mockReturnValue({ model: 'fake' });

  const messagesDependencies = {
    ...dependencies,
    createAnthropicModelClient: createMessagesClientMock,
  };

  beforeEach(() => {
    createMessagesClientMock.mockClear();
    createResponsesClientMock.mockClear();
    createCompletionsClientMock.mockClear();
    createCodexClientMock.mockClear();
  });

  it('routes an anthropic-messages provider to the Messages client whatever its id', () => {
    createModelClient(
      {
        provider: {
          id: 'third-party-anthropic',
          type: 'anthropic-messages',
          key: 'sk-key',
          baseUrl: 'https://api.z.ai/api/anthropic',
        },
        model: { ...model, provider: 'third-party-anthropic' },
      },
      messagesDependencies,
    );

    expect(createMessagesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'sk-key',
        baseUrl: 'https://api.z.ai/api/anthropic',
        providerModelId: 'model',
        reasoningDeclared: false,
      }),
    );
    expect(createResponsesClientMock).not.toHaveBeenCalled();
    expect(createCompletionsClientMock).not.toHaveBeenCalled();
    expect(createCodexClientMock).not.toHaveBeenCalled();
  });

  it('supplies the Anthropic default base URL when the entry configures none, even with an ambient ANTHROPIC_BASE_URL', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://ambient.example.test');
    try {
      createModelClient(
        {
          provider: {
            id: 'anthropic',
            type: 'anthropic-messages',
            key: 'sk-key',
            baseUrl: null,
          },
          model: { ...model, provider: 'anthropic' },
        },
        messagesDependencies,
      );
    } finally {
      vi.unstubAllEnvs();
    }

    // The default is the factory's decision, taken from the entry alone —
    // the ambient variable never reaches the client config.
    expect(createMessagesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.anthropic.com/v1',
      }),
    );
  });

  it('marks reasoningDeclared from the entry reasoning vocabulary', () => {
    createModelClient(
      {
        provider: {
          id: 'anthropic',
          type: 'anthropic-messages',
          key: 'sk-key',
          baseUrl: null,
        },
        model: {
          ...model,
          provider: 'anthropic',
          reasoning: {
            effortLevels: [{ value: 'high' }],
            defaultEffort: 'high',
            cacheInvalidatedByEffortChange: false,
          },
        },
      },
      messagesDependencies,
    );

    expect(createMessagesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningDeclared: true }),
    );
  });

  it('resolves two same-type providers each with their own credential and endpoint', () => {
    createModelClient(
      {
        provider: {
          id: 'anthropic-hosted',
          type: 'anthropic-messages',
          key: 'sk-hosted',
          baseUrl: null,
        },
        model: { ...model, provider: 'anthropic-hosted' },
      },
      messagesDependencies,
    );
    createModelClient(
      {
        provider: {
          id: 'anthropic-gateway',
          type: 'anthropic-messages',
          key: null,
          baseUrl: 'https://api.z.ai/api/anthropic',
        },
        model: { ...model, provider: 'anthropic-gateway' },
      },
      messagesDependencies,
    );

    expect(createMessagesClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        credential: 'sk-hosted',
        baseUrl: 'https://api.anthropic.com/v1',
        modelId: 'system:test:model',
      }),
    );
    expect(createMessagesClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        credential: undefined,
        baseUrl: 'https://api.z.ai/api/anthropic',
        modelId: 'system:test:model',
      }),
    );
  });

  it('carries the model providerOptions and maxOutputTokens into the Messages client config', () => {
    createModelClient(
      {
        provider: {
          id: 'anthropic',
          type: 'anthropic-messages',
          key: 'sk-key',
          baseUrl: null,
        },
        model: {
          ...model,
          provider: 'anthropic',
          providerOptions: { thinking: { display: null } },
          maxOutputTokens: 8192,
        },
      },
      messagesDependencies,
    );

    expect(createMessagesClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { thinking: { display: null } },
        maxOutputTokens: 8192,
      }),
    );
  });
});
