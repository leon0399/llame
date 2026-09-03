import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
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
  models: Array<PublicModelCatalogEntry>;
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

export class EffortNotAvailableError extends Error {
  readonly code = 'effort_not_available';
  readonly statusCode = 422;

  constructor(
    readonly modelId: string,
    readonly effort: string,
  ) {
    super(`Effort '${effort}' is not available for model '${modelId}'.`);
    this.name = 'EffortNotAvailableError';
  }
}

/**
 * Resolve the effort a run executes at: the requested level, or the model's
 * declared default when the request omitted one.
 *
 * Takes the ALREADY-VALIDATED catalog entry rather than a model id, so "model
 * first, then effort" is enforced by the signature instead of by caller
 * discipline — an unavailable model cannot reach this at all, and a level's
 * legality is meaningless without a resolved model.
 *
 * Matching is byte-exact against the model's own declared levels. Nothing is
 * trimmed, case-folded, or otherwise normalized: the levels are opaque provider
 * tokens, so `High` against a declared `high` is simply not a match.
 *
 * Returns `undefined` when the model declares no vocabulary and the request
 * supplied no effort — the run then sends no effort parameter at all, leaving
 * the provider's own default in force.
 *
 * A free function, not just a method, so the worker test harness resolves
 * effort through the same implementation the API does.
 */
export function resolveEffortSelection(
  model: SystemModelCatalogEntry,
  requested: string | undefined,
): string | undefined {
  if (requested === undefined) {
    return model.reasoning?.defaultEffort;
  }
  if (
    !model.reasoning?.effortLevels.some((level) => level.value === requested)
  ) {
    throw new EffortNotAvailableError(model.id, requested);
  }
  return requested;
}

/** The only capability a run needs to obtain a client (#268). */
export type ModelClientFactory = Pick<ModelsService, 'createClient'>;

/** The only capability the chat send path needs to validate a selection (#268). */
export type ModelSelectionValidator = Pick<
  ModelsService,
  'validateModelSelection' | 'resolveEffortSelection'
>;

/**
 * Test seam (anti-slop/no-module-mocking): no provider is registered for
 * this token in any module, so Nest always injects `undefined` and
 * `createClient` falls back to the real `createModelClient` — overriding it
 * requires constructing `ModelsService` directly (as the tests do), not
 * going through Nest's container.
 */
export const CREATE_MODEL_CLIENT = Symbol('CREATE_MODEL_CLIENT');

@Injectable()
export class ModelsService {
  private readonly modelsById: Map<string, SystemModelCatalogEntry>;
  private readonly providersById: Map<string, ProviderConfig>;

  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Optional()
    @Inject(CREATE_MODEL_CLIENT)
    private readonly createModelClientOverride?: typeof createModelClient,
  ) {
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

  /**
   * Method form of {@link resolveEffortSelection} — see it for the rules. It
   * exists because `ModelSelectionValidator` is a `Pick<ModelsService, …>`, so
   * the narrow contract can only name a method the class actually has.
   */
  resolveEffortSelection(
    model: SystemModelCatalogEntry,
    requested: string | undefined,
  ): string | undefined {
    return resolveEffortSelection(model, requested);
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

    return (this.createModelClientOverride ?? createModelClient)({
      provider,
      model,
    });
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
