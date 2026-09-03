import path from 'node:path';

import type { InstanceConfigReader } from '../instance-config/instance-config.service';
import { loadInstanceConfig } from '../instance-config/config-loader';
import {
  BUILT_IN_DEFAULTS,
  type ProviderConfig,
} from '../instance-config/llame-config';
import type { SystemModelCatalogEntry } from './model-catalog';
import { createModelClient } from './model-client-factory';
import type { createOpenAIModelClient } from './openai-model-client';
import {
  ModelConfigurationError,
  EffortNotAvailableError,
  ModelNotAvailableError,
  ModelsService,
} from './models.service';

// Test seam (anti-slop/no-module-mocking): overrides createOpenAIModelClient
// via ModelsService's own dependency-injection constructor param instead of
// module-mocking ./openai-model-client. No provider is registered for that
// token in production, so this override only takes effect when a test
// constructs ModelsService directly, as createService below does.
const createOpenAIModelClientMock = vi.mocked(
  vi.fn<typeof createOpenAIModelClient>(),
  { partial: true },
);
createOpenAIModelClientMock.mockReturnValue({
  model: 'stub',
  provider: 'openai',
  contextWindowTokens: 400_000,
  streamText: vi.fn(),
});
const createModelClientOverride: typeof createModelClient = (input) =>
  createModelClient(input, {
    createOpenAIModelClient: createOpenAIModelClientMock,
  });

const DEFAULT_PROVIDER: ProviderConfig = {
  id: 'openai',
  type: 'openai',
  key: null,
  baseUrl: null,
};

// Reproduces the formerly-hardcoded ACTIVE_SYSTEM_MODEL_IDS catalog exactly,
// as config entries — the shipped llame.config.json.example carries the same
// data (providers-and-models-as-code, #167).
const CATALOG: Array<SystemModelCatalogEntry> = [
  {
    id: 'system:openai:gpt-5.5',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.5',
    name: 'GPT-5.5',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: { input: 2.5, cachedInput: 0.25, output: 10 },
    systemPromptTemplate: 'Internal prompt 1',
    systemPromptSource: 'project_default',
  },
  {
    id: 'system:openai:gpt-5.4',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4',
    name: 'GPT-5.4',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: { input: 1.25, cachedInput: 0.125, output: 7.5 },
    systemPromptTemplate: 'Internal prompt 2',
    systemPromptSource: 'project_default',
  },
  {
    id: 'system:openai:gpt-5.4-mini',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: { input: 0.75, cachedInput: 0.075, output: 4.5 },
    systemPromptTemplate: 'Internal prompt 3',
    systemPromptSource: 'model_override',
  },
  {
    id: 'system:openai:gpt-5.4-nano',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    contextWindowTokens: 400_000,
    pricingUsdPer1M: { input: 0.1, cachedInput: 0.01, output: 0.4 },
    systemPromptTemplate: 'Internal prompt 4',
    systemPromptSource: 'project_default',
  },
  {
    id: 'system:openai:gpt-4o',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-4o',
    name: 'GPT-4o',
    contextWindowTokens: 128_000,
    pricingUsdPer1M: { input: 2.5, output: 10 },
    systemPromptTemplate: 'Internal prompt 5',
    systemPromptSource: 'project_default',
  },
  {
    id: 'system:openai:gpt-4o-mini',
    source: 'system',
    provider: 'openai',
    providerModelId: 'gpt-4o-mini',
    contextWindowTokens: 128_000,
    pricingUsdPer1M: { input: 0.15, cachedInput: 0.075, output: 0.6 },
    systemPromptTemplate: 'Internal prompt 6',
    systemPromptSource: 'project_default',
  },
];

function createService(overrides: {
  defaultModelId?: string | null;
  titleGenerationModelId?: string | null;
  models?: Array<SystemModelCatalogEntry>;
  providers?: Array<ProviderConfig>;
}): ModelsService {
  const instanceConfig: InstanceConfigReader = {
    config: {
      ...BUILT_IN_DEFAULTS,
      defaults: {
        modelId: overrides.defaultModelId ?? null,
        titleGenerationModelId: overrides.titleGenerationModelId ?? null,
      },
      providers: overrides.providers ?? [DEFAULT_PROVIDER],
      models: overrides.models ?? CATALOG,
    },
  };

  return new ModelsService(instanceConfig, createModelClientOverride);
}

describe('ModelsService', () => {
  beforeEach(() => {
    createOpenAIModelClientMock.mockClear();
  });

  it('returns the configured default and all configured models in catalog order', () => {
    const service = createService({
      defaultModelId: 'system:openai:gpt-5.4-mini',
    });

    const response = service.getAvailableModels();

    expect(response.defaultModelId).toBe('system:openai:gpt-5.4-mini');
    expect(response.models.map((model) => model.id)).toEqual(
      CATALOG.map((model) => model.id),
    );
    expect(response.models).toHaveLength(6);
    const [firstModel] = response.models;
    expect(firstModel).toMatchObject({
      id: 'system:openai:gpt-5.5',
      source: 'system',
      name: 'GPT-5.5',
    });
    expect(firstModel.contextWindowTokens).toEqual(expect.any(Number));
    expect(firstModel.pricingUsdPer1M?.input).toEqual(expect.any(Number));
    expect(firstModel.pricingUsdPer1M?.output).toEqual(expect.any(Number));
    expect(firstModel).not.toHaveProperty('providerModelId');
  });

  it('rejects a missing, blank, or unknown default model id as typed server configuration failure', () => {
    for (const defaultModelId of [undefined, null, 'not-configured']) {
      const service = createService({ defaultModelId });

      expect(() => service.getAvailableModels()).toThrow(
        ModelConfigurationError,
      );
      try {
        service.getAvailableModels();
        throw new Error('expected getAvailableModels to throw');
      } catch (error) {
        if (!(error instanceof ModelConfigurationError)) {
          throw new Error('Expected a ModelConfigurationError', {
            cause: error,
          });
        }
        expect(error.code).toBe('model_configuration_invalid');
        expect(error.statusCode).toBe(503);
      }
    }
  });

  it('requires the default id to be a member of the configured catalog', () => {
    const service = createService({
      defaultModelId: 'system:openai:gpt-4.1',
    });

    expect(() => service.getAvailableModels()).toThrow(
      /defaults\.modelId must reference a configured model/,
    );
  });

  it('resolves title generation only when it points to a configured model', () => {
    expect(
      createService({
        titleGenerationModelId: 'system:openai:gpt-5.4-nano',
      }).resolveTitleModelConfig(),
    ).toMatchObject({
      id: 'system:openai:gpt-5.4-nano',
      providerModelId: 'gpt-5.4-nano',
    });

    expect(
      createService({
        titleGenerationModelId: undefined,
      }).resolveTitleModelConfig()?.id,
    ).toBeUndefined();
    expect(
      createService({
        titleGenerationModelId: 'unknown',
      }).resolveTitleModelConfig()?.id,
    ).toBeUndefined();
  });

  it('creates a client from an opaque llame model id, routed through its configured provider', () => {
    const service = createService({
      providers: [
        {
          id: 'ollama',
          type: 'openai',
          key: null,
          baseUrl: 'http://localhost:11434/v1',
        },
      ],
      models: [{ ...CATALOG[2], provider: 'ollama' }],
    });

    service.createClient('system:openai:gpt-5.4-mini');

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith({
      credential: undefined,
      baseUrl: 'http://localhost:11434/v1',
      nativeOpenAI: false,
      providerModelId: 'gpt-5.4-mini',
      modelId: 'system:openai:gpt-5.4-mini',
      contextWindowTokens: 400_000,
      pricing: {
        inputUsdPer1M: 0.75,
        cachedInputUsdPer1M: 0.075,
        outputUsdPer1M: 4.5,
      },
    });
  });

  describe('validateModelSelection', () => {
    it('accepts an available model id when the default is configured', () => {
      const service = createService({
        defaultModelId: 'system:openai:gpt-5.4-mini',
      });

      expect(service.validateModelSelection('system:openai:gpt-4o').id).toBe(
        'system:openai:gpt-4o',
      );
    });

    it('rejects an unavailable model id with a 422 domain error when the default is valid', () => {
      const service = createService({
        defaultModelId: 'system:openai:gpt-5.4-mini',
      });

      expect(() =>
        service.validateModelSelection('system:openai:ghost'),
      ).toThrow(ModelNotAvailableError);
    });

    it('checks default configuration before the requested id: a broken default yields 503 even for an unavailable id', () => {
      const service = createService({ defaultModelId: null });

      // Ordering matters: config invalidity (503) must win over an unavailable
      // selection (422); the caller can't select against a broken catalog.
      expect(() =>
        service.validateModelSelection('system:openai:ghost'),
      ).toThrow(ModelConfigurationError);
    });
  });

  describe('resolveEffortSelection', () => {
    const REASONING = {
      effortLevels: [
        { value: 'none' },
        { value: 'low' },
        { value: 'high', label: 'High' },
      ],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: true,
    } as const;
    const reasoningModel: SystemModelCatalogEntry = {
      id: 'system:openai:reasoner',
      source: 'system',
      provider: 'openai',
      providerModelId: 'reasoner',
      contextWindowTokens: 128_000,
      systemPromptTemplate: 'Internal prompt R',
      systemPromptSource: 'project_default',
      reasoning: REASONING,
    };
    // Destructured out rather than deleted after the fact: `reasoning` is
    // optional, so omitting it needs no cast and no mutation.
    const { reasoning: _declared, ...plainModel } = {
      ...reasoningModel,
      id: 'system:openai:plain',
    };

    const service = () =>
      createService({
        defaultModelId: 'system:openai:reasoner',
        models: [reasoningModel, plainModel],
      });

    it('resolves the model default when the request omits an effort', () => {
      expect(service().resolveEffortSelection(reasoningModel, undefined)).toBe(
        'low',
      );
    });

    it('resolves a requested level that the model declares', () => {
      expect(service().resolveEffortSelection(reasoningModel, 'high')).toBe(
        'high',
      );
    });

    // A level meaning "do not reason" is a selection like any other; it must
    // survive resolution rather than collapsing into "nothing requested".
    it('resolves a disabling level rather than treating it as absent', () => {
      expect(service().resolveEffortSelection(reasoningModel, 'none')).toBe(
        'none',
      );
    });

    it('rejects a level the model does not declare', () => {
      expect(() =>
        service().resolveEffortSelection(reasoningModel, 'medium'),
      ).toThrow(EffortNotAvailableError);
    });

    it('rejects a published label when used as the effort value', () => {
      expect(() =>
        service().resolveEffortSelection(reasoningModel, 'High'),
      ).toThrow(EffortNotAvailableError);
    });

    // Case-sensitivity falls out of "no normalization" rather than being a
    // rule of its own — nothing folds the request onto a declared level.
    it('rejects a level differing only by letter case', () => {
      expect(() =>
        service().resolveEffortSelection(reasoningModel, 'None'),
      ).toThrow(EffortNotAvailableError);
    });

    it('rejects any effort for a model that declares no vocabulary', () => {
      expect(() => service().resolveEffortSelection(plainModel, 'low')).toThrow(
        EffortNotAvailableError,
      );
    });

    it('resolves to nothing for a model that declares no vocabulary and no request', () => {
      expect(
        service().resolveEffortSelection(plainModel, undefined),
      ).toBeUndefined();
    });

    // A level legal somewhere in the catalog is still illegal here: legality is
    // a property of the SELECTED model, never of the instance.
    it('rejects a level declared by a different catalog model', () => {
      expect(() =>
        service().resolveEffortSelection(plainModel, 'high'),
      ).toThrow(EffortNotAvailableError);
    });
  });
});

describe('ModelsService — GET /api/v1/models contract stability (#161, providers-and-models-as-code #167)', () => {
  it('the committed llame.config.json.example public catalog is exactly the loaded config with internal fields stripped', () => {
    process.env.LLAME_CONFIG_PATH = path.resolve(
      __dirname,
      '../../llame.config.json.example',
    );
    const config = loadInstanceConfig();
    delete process.env.LLAME_CONFIG_PATH;

    const service = new ModelsService({ config });
    const response = service.getAvailableModels();

    expect(response.defaultModelId).toBe('system:openai:gpt-5.4-mini');
    expect(response.models.map((m) => m.id)).toEqual(
      config.models.map((m) => m.id),
    );

    // Derived from the LOADED config rather than hand-transcribed, so this
    // doesn't need re-editing every time the example's catalog changes — it
    // stays a meaningful check because the source config provably carries
    // the fields being stripped (asserted below), not because both sides are
    // vacuously the same hand-copied literal.
    const expectedPublic = config.models.map(
      ({
        provider: _p,
        providerModelId: _pmi,
        compactionThresholdTokens: _ct,
        systemPromptTemplate: _spt,
        systemPromptSource: _sps,
        ...pub
      }) => pub,
    );
    expect(response.models).toEqual(expectedPublic);

    expect(
      config.models.find((m) => m.id === 'system:openai:gpt-5.4-mini'),
    ).toMatchObject({ provider: 'openai', compactionThresholdTokens: 300 });
    for (const model of response.models) {
      expect(model).not.toHaveProperty('providerModelId');
      expect(model).not.toHaveProperty('provider');
      expect(model).not.toHaveProperty('compactionThresholdTokens');
      expect(model).not.toHaveProperty('systemPrompt');
      expect(model).not.toHaveProperty('systemPromptSource');
      expect(model).not.toHaveProperty('systemPromptFile');
    }
  });
});
