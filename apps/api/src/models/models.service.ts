import { Injectable } from '@nestjs/common';

import { InstanceConfigService } from '../instance-config/instance-config.service';
import type { ProviderConfig } from '../instance-config/llame-config';
import {
  toPublicModel,
  type PublicModelCatalogEntry,
  type SystemModelCatalogEntry,
} from './model-catalog';
import { createModelClient } from './model-client-factory';
import {
  requireModelCredential,
  resolveModelCredential as resolveModelCredentialSeam,
  type ModelClient,
  type ModelCredentialResolver,
} from './model-client';

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
  private readonly modelsById: Map<string, SystemModelCatalogEntry>;
  private readonly providersById: Map<string, ProviderConfig>;

  constructor(private readonly instanceConfig: InstanceConfigService) {
    this.modelsById = new Map(
      this.instanceConfig.config.models.map((model) => [model.id, model]),
    );
    this.providersById = new Map(
      this.instanceConfig.config.providers.map((provider) => [
        provider.id,
        provider,
      ]),
    );
  }

  getAvailableModels(): ModelsAvailability {
    const defaultModel = this.resolveDefaultModelConfig();
    if (this.modelsById.size === 0) {
      throw new ModelConfigurationError('No models are configured.');
    }

    return {
      defaultModelId: defaultModel.id,
      models: Array.from(this.modelsById.values(), toPublicModel),
    };
  }

  resolveDefaultModelConfig(): SystemModelCatalogEntry {
    // InstanceConfigService already hands out a trimmed-or-null value, and
    // config-loader has already boot-validated that a SET modelId references
    // a configured model — this only guards the unset case.
    const modelId = this.instanceConfig.config.defaults.modelId;
    if (!modelId) {
      throw new ModelConfigurationError('defaults.modelId is required.');
    }

    return this.resolveConfiguredModel(
      modelId,
      'defaults.modelId must reference a configured model.',
    );
  }

  resolveTitleModelConfig(): SystemModelCatalogEntry | undefined {
    const modelId = this.instanceConfig.config.defaults.titleGenerationModelId;
    if (!modelId) {
      return undefined;
    }

    return this.modelsById.get(modelId);
  }

  requireAvailableModel(modelId: string): SystemModelCatalogEntry {
    const model = this.modelsById.get(modelId);
    if (!model) {
      throw new ModelNotAvailableError(modelId);
    }
    return model;
  }

  validateModelSelection(modelId: string): SystemModelCatalogEntry {
    this.resolveDefaultModelConfig();
    return this.requireAvailableModel(modelId);
  }

  /** Per-user BYOK seam (#37/v0.4) — preserved, unused today: no caller supplies `resolveCredential` yet. */
  resolveModelCredential(
    userId: string,
    resolveCredential?: ModelCredentialResolver,
  ): Promise<string> {
    return resolveModelCredentialSeam(userId, resolveCredential);
  }

  requireModelCredential(
    credential: string | null | undefined,
    userId?: string,
  ): string {
    return requireModelCredential(credential, userId);
  }

  /**
   * Build a model's client: model -> its provider entry -> a client
   * dispatched by the provider's `type` (model-client-factory.ts). Always
   * resolves the caller's explicit model id — never a silent default (the
   * selected id is persisted for execution, spec "Selected model id is
   * persisted for execution").
   */
  createClient(modelId: string): ModelClient {
    const model = this.requireAvailableModel(modelId);
    const provider = this.providersById.get(model.provider);
    if (!provider) {
      // Unreachable once config-loader's boot-time reference check has run
      // (models[].provider is validated against providers[].id at load
      // time) — kept as defense-in-depth for hand-built config fixtures in
      // tests that bypass the loader.
      throw new ModelConfigurationError(
        `Model '${modelId}' references unknown provider '${model.provider}'.`,
      );
    }

    return createModelClient({ provider, model });
  }

  private resolveConfiguredModel(
    modelId: string,
    message: string,
  ): SystemModelCatalogEntry {
    const model = this.modelsById.get(modelId);
    if (!model) {
      throw new ModelConfigurationError(message);
    }
    return model;
  }
}
