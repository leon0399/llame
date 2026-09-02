import { HttpException, HttpStatus } from '@nestjs/common';

import { ModelsController, type ModelsReader } from './models.controller';
import { ModelConfigurationError } from './models.service';
import { toAvailableModelResponse } from './dto/models.dto';
import type { PublicModelCatalogEntry } from './model-catalog';

describe('ModelsController', () => {
  // Held by reference so the copy assertion below has the catalog's own array
  // to compare against.
  const catalogTags: Array<string> = ['flagship'];
  const catalogReasoning = {
    effortLevels: [{ value: 'low', label: 'Low' }],
    defaultEffort: 'low',
    cacheInvalidatedByEffortChange: false,
  };

  function makeController(service?: Partial<ModelsReader>) {
    const modelsService = {
      getAvailableModels: vi.fn().mockReturnValue({
        defaultModelId: 'system:openai:gpt-5.4-mini',
        models: [
          {
            id: 'system:openai:gpt-5.5',
            source: 'system',
            name: 'GPT-5.5',
            contextWindowTokens: 400_000,
            tags: catalogTags,
            reasoning: catalogReasoning,
          },
          {
            id: 'system:openai:gpt-5.4-mini',
            source: 'system',
            name: 'GPT-5.4 Mini',
          },
        ],
      }),
      ...service,
    } satisfies ModelsReader;

    return {
      controller: new ModelsController(modelsService),
      service: modelsService,
    };
  }

  it('returns the flat model envelope from the service without provider execution ids', () => {
    const { controller } = makeController();

    const response = controller.listModels();

    expect(response).toEqual({
      defaultModelId: 'system:openai:gpt-5.4-mini',
      models: [
        {
          id: 'system:openai:gpt-5.5',
          source: 'system',
          name: 'GPT-5.5',
          contextWindowTokens: 400_000,
          tags: ['flagship'],
          reasoning: {
            effortLevels: [{ value: 'low', label: 'Low' }],
            defaultEffort: 'low',
            cacheInvalidatedByEffortChange: false,
          },
        },
        {
          id: 'system:openai:gpt-5.4-mini',
          source: 'system',
          name: 'GPT-5.4 Mini',
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('providerModelId');
  });

  it("hands out copies of the catalog's nested data", () => {
    // The catalog is a process-lifetime singleton, so `toAvailableModelResponse`
    // builds the response field by field and copies `tags`/`reasoning` rather
    // than spreading the entry. Without this assertion a `return { ...model }`
    // shallow copy passes every other test in this file while letting one
    // caller's mutation reach every subsequent caller.
    const { controller } = makeController();

    const response = controller.listModels();

    expect(response.models[0]?.tags).toEqual(['flagship']);
    expect(response.models[0]?.tags).not.toBe(catalogTags);
    expect(response.models[0]?.reasoning).toEqual(catalogReasoning);
    expect(response.models[0]?.reasoning).not.toBe(catalogReasoning);
    expect(response.models[0]?.reasoning?.effortLevels).not.toBe(
      catalogReasoning.effortLevels,
    );
    expect(response.models[0]?.reasoning?.effortLevels[0]).not.toBe(
      catalogReasoning.effortLevels[0],
    );
  });

  it('maps model configuration failures to the standard error body', () => {
    const { controller } = makeController({
      getAvailableModels: vi.fn(() => {
        throw new ModelConfigurationError('DEFAULT_MODEL_ID is required.');
      }),
    });

    expect(() => controller.listModels()).toThrow(HttpException);

    try {
      controller.listModels();
      throw new Error('expected controller to throw');
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw new Error('Expected an HttpException', { cause: error });
      }
      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(error.getResponse()).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'DEFAULT_MODEL_ID is required.',
        code: 'model_configuration_invalid',
      });
    }
  });

  it('copies every optional catalog field and nested reasoning levels', () => {
    const model: PublicModelCatalogEntry = {
      id: 'system:openai:full',
      source: 'system',
      name: 'Full model',
      description: 'Description',
      tags: ['one', 'two'],
      icon: 'icon.svg',
      contextWindowTokens: 128_000,
      pricingUsdPer1M: { input: 1, cachedInput: 0.2, output: 4 },
      knowledgeCutoff: '2025-01',
      reasoning: {
        effortLevels: [{ value: 'low' }, { value: 'high', label: 'High' }],
        defaultEffort: 'low',
        cacheInvalidatedByEffortChange: true,
      },
      website: 'https://example.test',
      apiDocs: 'https://example.test/docs',
      modelPage: 'https://example.test/model',
      releasedAt: '2026-01-01',
    };

    const response = toAvailableModelResponse(model);
    const reasoning = model.reasoning;
    if (reasoning === undefined) throw new Error('expected reasoning metadata');

    expect(response).toEqual(model);
    expect(response.tags).not.toBe(model.tags);
    expect(response.reasoning?.effortLevels).not.toBe(reasoning.effortLevels);
    expect(response.reasoning?.effortLevels[1]).toEqual({
      value: 'high',
      label: 'High',
    });
  });
});
