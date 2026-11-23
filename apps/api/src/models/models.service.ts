import { Inject, Injectable, Optional } from '@nestjs/common';

import { configuredCredentials } from '../instance-config/configured-credentials';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import type { ProductIdentityReader } from '../instance-config/product-identity';
import type { ProviderConfig } from '../instance-config/llame-config';
import type { ModelRoleConfig } from '../instance-config/model-roles-config';
import { type PermissionMode } from '../tools/permissions/permission-mode';
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
import { parseModelSelector, roleSelector } from './model-selector';

/** One candidate of a published role, as a client may present it. */
export type ModelRoleCandidateAvailability = {
  modelId: string;
  /** Config-declared effort; absent when the candidate declares none. */
  effort?: string;
  /** Per-token (`usage`) billing — false for `subscription` and `free`. */
  paid: boolean;
};

/** One published model role, resolvable through its `@name` selector. */
export type ModelRoleAvailability = {
  selector: string;
  candidates: Array<ModelRoleCandidateAvailability>;
};

export type ModelsAvailability = {
  /**
   * The configured default selector itself: `@role` or a model id. A role is
   * resolved to one sendable model through `roles`.
   */
  defaultSelector: string;
  models: Array<PublicModelCatalogEntry>;
  roles: Array<ModelRoleAvailability>;
};

const DEFAULT_SELECTOR_REQUIRED = 'defaults.selector is required.';

const DEFAULT_SELECTOR_REFERENCE =
  'defaults.selector must reference a configured model or model role.';

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

export class PermissionModeNotAvailableError extends Error {
  readonly code = 'permission_mode_not_available';
  readonly statusCode = 422;

  constructor(readonly mode: string) {
    super(`Permission mode '${mode}' is not available.`);
    this.name = 'PermissionModeNotAvailableError';
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

/**
 * The permission mode a Run stores: the requested one, or `default` when the
 * request named none. Both admission paths — a chat send and a follow-up
 * request — resolve it here, so a mode default or alias can never differ
 * between them.
 */
export function resolvePermissionMode(
  requested: PermissionMode | undefined,
  enabled: ReadonlyArray<PermissionMode>,
): PermissionMode {
  const mode = requested ?? 'default';

  if (!enabled.includes(mode)) {
    throw new PermissionModeNotAvailableError(mode);
  }

  return mode;
}

/**
 * The model, effort, and permission mode of one send, resolved together: the
 * model is in the catalog, the effort is one of its levels, and the mode is
 * enabled. A chat send and the promotion of a pending item share this one
 * check, so an item is promoted only under settings a send would be accepted
 * with now. The effort is resolved from the already-validated model, so an
 * unavailable model is reported without the effort ever being considered.
 */
export function resolveSendSettings(
  models: ModelSelectionValidator,
  enabledModes: ReadonlyArray<PermissionMode>,
  requested: {
    modelId: string;
    effort?: string | undefined;
    permissionMode?: PermissionMode | undefined;
  },
) {
  const model = models.validateModelSelection(requested.modelId);

  return {
    effort: models.resolveEffortSelection(model, requested.effort),
    permissionMode: resolvePermissionMode(
      requested.permissionMode,
      enabledModes,
    ),
  };
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
  private readonly rolesByName: Map<string, ModelRoleConfig>;

  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader &
      ProductIdentityReader,
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
    this.rolesByName = new Map(
      this.instanceConfig.config.modelRoles.map((role) => [role.name, role]),
    );
  }

  getAvailableModels(): ModelsAvailability {
    const defaultSelector = this.configuredDefaultSelector();

    // A selector that resolves to nothing is a 503 for the whole endpoint: the
    // catalogue must never publish a default a client cannot turn into a send.
    this.resolveSelectorEntry(defaultSelector, DEFAULT_SELECTOR_REFERENCE);

    if (this.modelsById.size === 0) {
      throw new ModelConfigurationError('No models are configured.');
    }

    return {
      defaultSelector,
      models: Array.from(this.modelsById.values(), toPublicModel),
      roles: this.modelRoles(),
    };
  }

  resolveDefaultModelConfig(): SystemModelCatalogEntry {
    // InstanceConfigService already hands out a trimmed-or-null value, and
    // config-loader has already boot-validated that a SET selector references
    // a configured model or role — this only guards the unset case.
    return this.resolveSelectorEntry(
      this.configuredDefaultSelector(),
      DEFAULT_SELECTOR_REFERENCE,
    );
  }

  resolveTitleModelConfig(): SystemModelCatalogEntry | undefined {
    const selector =
      this.instanceConfig.config.defaults.titleGenerationSelector;

    if (!selector) {
      return undefined;
    }

    const parsed = parseModelSelector(selector);

    if (parsed.kind === 'model') {
      return this.modelsById.get(parsed.modelId);
    }

    // This layer stops at the primary candidate; walking the rest of the
    // chain (a later layer) starts from here.
    const primary = this.rolesByName.get(parsed.roleName)?.candidates[0];

    return primary === undefined
      ? undefined
      : this.modelsById.get(primary.modelId);
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
      userAgent: this.instanceConfig.productUserAgent,
      // Read through the loader's accessor (design D1), never from
      // `LlameConfig` itself: every failure this client reports is redacted
      // against the instance's configured credentials.
      credentials: configuredCredentials(this.instanceConfig.config),
    });
  }

  private configuredDefaultSelector(): string {
    const selector = this.instanceConfig.config.defaults.selector;

    if (!selector) {
      throw new ModelConfigurationError(DEFAULT_SELECTOR_REQUIRED);
    }

    return selector;
  }

  /**
   * Resolve a selector to one executable entry. A role yields its primary (the
   * first configured candidate): this layer sends an exact model id, so the
   * rest of a role's chain is a later layer's walk.
   */
  private resolveSelectorEntry(
    selector: string,
    message: string,
  ): SystemModelCatalogEntry {
    const parsed = parseModelSelector(selector);

    const modelId =
      parsed.kind === 'model'
        ? parsed.modelId
        : this.rolesByName.get(parsed.roleName)?.candidates[0]?.modelId;

    const model =
      modelId === undefined ? undefined : this.modelsById.get(modelId);

    if (!model) {
      throw new ModelConfigurationError(message);
    }

    return model;
  }

  /**
   * The published role table. `paid` comes from the internal catalog entry
   * because `toPublicModel` strips `billing`; only per-token (`usage`) billing
   * is paid, so a `subscription` or `free` candidate is not.
   */
  private modelRoles(): Array<ModelRoleAvailability> {
    return this.instanceConfig.config.modelRoles.map((role) => ({
      selector: roleSelector(role.name),
      candidates: role.candidates.map((candidate) => {
        const availability: ModelRoleCandidateAvailability = {
          modelId: candidate.modelId,
          paid: this.modelsById.get(candidate.modelId)?.billing === 'usage',
        };

        if (candidate.effort !== undefined) {
          availability.effort = candidate.effort;
        }

        return availability;
      }),
    }));
  }
}
