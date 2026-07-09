import { HttpException, HttpStatus } from '@nestjs/common';

import { ModelsController } from './models.controller';
import { ModelConfigurationError, ModelsService } from './models.service';

describe('ModelsController', () => {
  function makeController(service?: Partial<ModelsService>): {
    controller: ModelsController;
    service: jest.Mocked<ModelsService>;
  } {
    const modelsService = {
      getAvailableModels: jest.fn().mockReturnValue({
        defaultModelId: 'system:openai:gpt-5.4-mini',
        models: [
          {
            id: 'system:openai:gpt-5.5',
            source: 'system',
            name: 'GPT-5.5',
          },
          {
            id: 'system:openai:gpt-5.4-mini',
            source: 'system',
            name: 'GPT-5.4 Mini',
          },
        ],
      }),
      ...service,
    } as unknown as jest.Mocked<ModelsService>;

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

  it('maps model configuration failures to the standard error body', () => {
    const { controller } = makeController({
      getAvailableModels: jest.fn(() => {
        throw new ModelConfigurationError('DEFAULT_MODEL_ID is required.');
      }),
    });

    expect(() => controller.listModels()).toThrow(HttpException);

    try {
      controller.listModels();
      throw new Error('expected controller to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(exception.getResponse()).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'DEFAULT_MODEL_ID is required.',
        code: 'model_configuration_invalid',
      });
    }
  });
});
