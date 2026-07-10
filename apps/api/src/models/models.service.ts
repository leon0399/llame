import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_SYSTEM_MODEL_ID,
  PUBLIC_SYSTEM_MODELS,
  SYSTEM_MODEL_BY_ID,
  type ActiveSystemModelId,
  type PublicModelCatalogEntry,
  type SystemModelCatalogEntry,
} from './model-catalog';
import {
  resolveModelCredential,
  requireModelCredential,
  type ModelClient,
  type ModelCredentialResolver,
} from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

export type ModelsAvailability = {
  defaultModelId: string;
  models: PublicModelCatalogEntry[];
};

export class ModelConfigurationError extends Error {
  readonly code = 'model_configuration_invalid';
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigurationError';
  }
}

export class ModelNotAvailableError extends Error {
  readonly code = 'model_not_available';
  readonly statusCode = 422;

  constructor(readonly modelId: string) {
    super(`Model '${modelId}' is not available.`);
    this.name = 'ModelNotAvailableError';
  }
}

@Injectable()
export class ModelsService {
  constructor(private readonly config: ConfigService) {}

  getAvailableModels(): ModelsAvailability {
    const defaultModel = this.resolveDefaultModelConfig();
    if (PUBLIC_SYSTEM_MODELS.length === 0) {
      throw new ModelConfigurationError('No models are configured.');
    }

    return {
      defaultModelId: defaultModel.id,
      models: PUBLIC_SYSTEM_MODELS.map((model) => ({ ...model })),
    };
  }

  resolveDefaultModelConfig(): SystemModelCatalogEntry {
    const modelId = this.config.get<string>('DEFAULT_MODEL_ID')?.trim();
    if (!modelId) {
      throw new ModelConfigurationError('DEFAULT_MODEL_ID is required.');
    }

    return this.resolveConfiguredModel(
      modelId,
      'DEFAULT_MODEL_ID must reference an available model.',
    );
  }

  resolveTitleModelConfig(): SystemModelCatalogEntry | undefined {
    const modelId = this.config
      .get<string>('TITLE_GENERATION_MODEL_ID')
      ?.trim();
    if (!modelId) {
      return undefined;
    }

    return SYSTEM_MODEL_BY_ID.get(modelId as ActiveSystemModelId);
  }

  requireAvailableModel(modelId: string): SystemModelCatalogEntry {
    const model = SYSTEM_MODEL_BY_ID.get(modelId as ActiveSystemModelId);
    if (!model) {
      throw new ModelNotAvailableError(modelId);
    }
    return model;
  }

  validateModelSelection(modelId: string): SystemModelCatalogEntry {
    this.resolveDefaultModelConfig();
    return this.requireAvailableModel(modelId);
  }

  getOpenAIProviderCredential(): string | undefined {
    return normalizeCredential(this.config.get<string>('OPENAI_API_KEY'));
  }

  resolveModelCredential(
    userId: string,
    resolveCredential?: ModelCredentialResolver,
  ): Promise<string> {
    return resolveModelCredential(
      userId,
      resolveCredential ?? (() => this.config.get<string>('OPENAI_API_KEY')),
    );
  }

  requireModelCredential(
    credential: string | null | undefined,
    userId?: string,
  ): string {
    return requireModelCredential(credential, userId);
  }

  createOpenAIClient(input: {
    credential?: string | null;
    modelId: string;
  }): ModelClient {
    // Always resolve the caller's explicit model id — never a silent default.
    // The selected id is execution configuration persisted on the run
    // (spec: "Selected model id is persisted for execution").
    const model = this.requireAvailableModel(input.modelId);

    return createOpenAIModelClient({
      credential: normalizeCredential(input.credential),
      providerModelId: model.providerModelId,
      modelId: model.id,
      contextWindowTokens: model.contextWindowTokens,
      baseUrl: this.config.get<string>('OPENAI_BASE_URL') || undefined,
    });
  }

  private resolveConfiguredModel(
    modelId: string,
    message: string,
  ): SystemModelCatalogEntry {
    const model = SYSTEM_MODEL_BY_ID.get(modelId as ActiveSystemModelId);
    if (!model) {
      throw new ModelConfigurationError(message);
    }
    return model;
  }
}

function normalizeCredential(
  credential: string | null | undefined,
): string | undefined {
  const normalized = credential?.trim();
  return normalized ? normalized : undefined;
}

export { DEFAULT_SYSTEM_MODEL_ID };
