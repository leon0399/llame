import { ConfigService } from '@nestjs/config';

import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  ACTIVE_SYSTEM_MODEL_IDS,
  DEFAULT_SYSTEM_MODEL_ID,
} from './model-catalog';
import { createOpenAIModelClient } from './openai-model-client';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
  ModelsService,
} from './models.service';

jest.mock('./openai-model-client', () => ({
  createOpenAIModelClient: jest.fn(() => ({
    model: 'stub',
    provider: 'openai',
    streamText: jest.fn(),
  })),
}));

const createOpenAIModelClientMock = jest.mocked(createOpenAIModelClient);

function createService(env: Record<string, string | undefined>): ModelsService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;

  const instanceConfig = {
    config: {
      defaults: {
        modelId: env.DEFAULT_MODEL_ID ?? null,
        titleGenerationModelId: env.TITLE_GENERATION_MODEL_ID ?? null,
      },
    },
  } as unknown as InstanceConfigService;

  return new ModelsService(config, instanceConfig);
}

describe('ModelsService', () => {
  beforeEach(() => {
    createOpenAIModelClientMock.mockClear();
  });

  it('returns the configured default and all active system models in catalog order without requiring OPENAI_API_KEY', () => {
    const service = createService({
      DEFAULT_MODEL_ID: 'system:openai:gpt-5.4-mini',
      OPENAI_API_KEY: undefined,
    });

    const response = service.getAvailableModels();

    expect(response.defaultModelId).toBe('system:openai:gpt-5.4-mini');
    expect(response.models.map((model) => model.id)).toEqual(
      ACTIVE_SYSTEM_MODEL_IDS,
    );
    expect(response.models).toHaveLength(6);
    const [firstModel] = response.models;
    expect(firstModel).toMatchObject({
      id: 'system:openai:gpt-5.5',
      source: 'system',
      name: 'GPT-5.5',
    });
    expect(typeof firstModel.contextWindowTokens).toBe('number');
    expect(typeof firstModel.pricingUsdPer1M?.input).toBe('number');
    expect(typeof firstModel.pricingUsdPer1M?.output).toBe('number');
    expect(firstModel).not.toHaveProperty('providerModelId');
  });

  it('rejects a missing, blank, or unknown DEFAULT_MODEL_ID as typed server configuration failure', () => {
    for (const DEFAULT_MODEL_ID of [undefined, '', 'not-configured']) {
      const service = createService({ DEFAULT_MODEL_ID });

      expect(() => service.getAvailableModels()).toThrow(
        ModelConfigurationError,
      );
      try {
        service.getAvailableModels();
        throw new Error('expected getAvailableModels to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelConfigurationError);
        const configurationError = error as ModelConfigurationError;
        expect(configurationError.code).toBe('model_configuration_invalid');
        expect(configurationError.statusCode).toBe(503);
      }
    }
  });

  it('requires the default id to be a member of the active system catalog', () => {
    const service = createService({
      DEFAULT_MODEL_ID: 'system:openai:gpt-4.1',
    });

    expect(() => service.getAvailableModels()).toThrow(
      /DEFAULT_MODEL_ID must reference an available model/,
    );
  });

  it('resolves title generation only when TITLE_GENERATION_MODEL_ID points to an active system model', () => {
    expect(
      createService({
        TITLE_GENERATION_MODEL_ID: 'system:openai:gpt-5.4-nano',
      }).resolveTitleModelConfig(),
    ).toMatchObject({
      id: 'system:openai:gpt-5.4-nano',
      providerModelId: 'gpt-5.4-nano',
    });

    expect(
      createService({
        TITLE_GENERATION_MODEL_ID: undefined,
      }).resolveTitleModelConfig()?.id,
    ).toBeUndefined();
    expect(
      createService({
        TITLE_GENERATION_MODEL_ID: 'unknown',
      }).resolveTitleModelConfig()?.id,
    ).toBeUndefined();
  });

  it('creates provider clients from an opaque llame model id and ignores OPENAI_MODEL', () => {
    const service = createService({
      OPENAI_API_KEY: '',
      OPENAI_MODEL: 'ignored-provider-model',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
    });

    service.createOpenAIClient({
      credential: undefined,
      modelId: 'system:openai:gpt-5.4-mini',
    });

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith({
      credential: undefined,
      providerModelId: 'gpt-5.4-mini',
      modelId: 'system:openai:gpt-5.4-mini',
      contextWindowTokens: 400_000,
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  describe('validateModelSelection', () => {
    it('accepts an available model id when the default is configured', () => {
      const service = createService({
        DEFAULT_MODEL_ID: 'system:openai:gpt-5.4-mini',
      });

      expect(service.validateModelSelection('system:openai:gpt-4o').id).toBe(
        'system:openai:gpt-4o',
      );
    });

    it('rejects an unavailable model id with a 422 domain error when the default is valid', () => {
      const service = createService({
        DEFAULT_MODEL_ID: 'system:openai:gpt-5.4-mini',
      });

      expect(() =>
        service.validateModelSelection('system:openai:ghost'),
      ).toThrow(ModelNotAvailableError);
    });

    it('checks default configuration before the requested id: a broken default yields 503 even for an unavailable id', () => {
      const service = createService({ DEFAULT_MODEL_ID: '' });

      // Ordering matters: config invalidity (503) must win over an unavailable
      // selection (422); the caller can't select against a broken catalog.
      expect(() =>
        service.validateModelSelection('system:openai:ghost'),
      ).toThrow(ModelConfigurationError);
    });
  });

  it('falls back to the documented default only in tests that ask for the constant directly', () => {
    expect(DEFAULT_SYSTEM_MODEL_ID).toBe('system:openai:gpt-5.4-mini');
  });
});
