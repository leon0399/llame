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
import { ROLE_SIGN } from './model-selector';
import {
  chooseEffort,
  chooseSelector,
  nextSelectionForWrite,
  offerSelector,
  type ChatModelSelection,
  type SelectionCatalog,
  type SelectionRequest,
  type SelectionWriter,
} from './model-selection';

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

/** What one admission resolved: the values its Run records, and its selection write. */
export type ResolvedSendSettings = {
  selector: string;
  modelId: string;
  effort: string | undefined;
  permissionMode: PermissionMode;
  /**
   * The revision the Run records: the one this admission wrote, else the
   * stored one, else null. One formula for every path, owner or derived.
   */
  selectionRevision: number | null;
  nextSelection: ChatModelSelection | undefined;
};

/**
 * The model, effort, and permission mode of one admission, resolved together:
 * the selector is the named, stored, or default one; its model is in the
 * catalog; the effort follows "An omitted effort follows one order"; the mode
 * is enabled. Every admission path — a send, chat creation, Regenerate,
 * `/compact`, queue promotion, and a job notice — shares this one check, so a
 * pending item starts only under settings a send would be accepted with now.
 *
 * The selector and the effort resolve first: the effort's legality is defined
 * by the resolved model, so an unavailable selector is reported without the
 * effort ever being considered, exactly as before.
 */
export function resolveSendSettings(
  models: ModelSelectionValidator,
  enabledModes: ReadonlyArray<PermissionMode>,
  input: {
    stored: ChatModelSelection | null;
    request: SelectionRequest;
    writer: SelectionWriter;
    permissionMode?: PermissionMode | undefined;
  },
): ResolvedSendSettings {
  const selection = models.resolveSelection(
    input.stored,
    input.request,
    input.writer,
  );

  return {
    selector: selection.selector,
    modelId: selection.model.id,
    effort: selection.effort,
    permissionMode: resolvePermissionMode(input.permissionMode, enabledModes),
    selectionRevision:
      selection.nextSelection?.revision ?? input.stored?.revision ?? null,
    nextSelection: selection.nextSelection,
  };
}

const DEFAULT_SELECTOR_REQUIRED = 'defaults.selector is required.';

const DEFAULT_SELECTOR_REFERENCE =
  'defaults.selector must reference a configured model or model role.';

/** What one selection resolves to, before its caller decides whether to store it. */
export type ResolvedSelection = {
  selector: string;
  model: SystemModelCatalogEntry;
  effort: string | undefined;
  nextSelection: ChatModelSelection | undefined;
};

/**
 * Resolve one selection against a catalog, mapping each refusal to its domain
 * error (design D3). It lives beside the errors it raises, so the worker test
 * harnesses resolve a selector through the same rules the API does instead of
 * restating them.
 */
export function resolveSelectionFromCatalog(
  catalog: SelectionCatalog,
  stored: ChatModelSelection | null,
  request: SelectionRequest,
  writer: SelectionWriter,
): ResolvedSelection {
  const chosen = chooseSelector(catalog, stored, request);

  if (chosen.kind === 'unknown') {
    throw new ModelNotAvailableError(chosen.selector);
  }

  if (chosen.kind === 'no-default') {
    throw new ModelConfigurationError(DEFAULT_SELECTOR_REQUIRED);
  }

  if (chosen.kind === 'unresolved-default') {
    throw new ModelConfigurationError(DEFAULT_SELECTOR_REFERENCE);
  }

  const effort = chooseEffort({
    model: chosen.model,
    requested: request.effort,
    storedEffort: chosen.storedUsed ? (stored?.effort ?? null) : null,
    candidateEffort: chosen.candidate?.effort,
  });

  if (effort.kind === 'undeclared') {
    throw new EffortNotAvailableError(chosen.model.id, effort.effort);
  }

  const resolvedEffort = effort.kind === 'effort' ? effort.effort : undefined;

  return {
    selector: chosen.selector,
    model: chosen.model,
    effort: resolvedEffort,
    nextSelection: nextSelectionForWrite({
      stored,
      request,
      writer,
      selector: chosen.selector,
      effort: resolvedEffort,
      storedUsed: chosen.storedUsed,
    }),
  };
}

/** The only capability a run needs to obtain a client (#268). */
export type ModelClientFactory = Pick<ModelsService, 'createClient'>;

/** The only capability the admission paths need to resolve a selection (#268). */
export type ModelSelectionValidator = Pick<
  ModelsService,
  'validateModelSelection' | 'resolveEffortSelection' | 'resolveSelection'
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
  /** The boot maps and `defaults.selector`, as the selection resolver reads them. */
  private readonly selectionCatalog: SelectionCatalog;

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
    this.selectionCatalog = {
      defaultSelector:
        this.instanceConfig.config.defaults.selector ?? undefined,
      roleCandidates: (roleName) => this.rolesByName.get(roleName)?.candidates,
      model: (modelId) => this.modelsById.get(modelId),
    };
  }

  getAvailableModels(): ModelsAvailability {
    const defaultSelector = this.configuredDefaultSelector();

    // A selector that resolves to nothing is a 503 for the whole endpoint: the
    // catalogue must never publish a default a client cannot turn into a send.
    this.resolveDefaultModelConfig();

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
    const model = offerSelector(
      this.selectionCatalog,
      this.configuredDefaultSelector(),
    )?.model;

    if (!model) {
      throw new ModelConfigurationError(DEFAULT_SELECTOR_REFERENCE);
    }

    return model;
  }

  resolveTitleModelConfig(): SystemModelCatalogEntry | undefined {
    const selector =
      this.instanceConfig.config.defaults.titleGenerationSelector;

    return selector === null
      ? undefined
      : offerSelector(this.selectionCatalog, selector)?.model;
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

  /**
   * Resolve one admission's selector, model, and effort (design D3). The
   * caller runs it inside the transaction that holds the Chat row, with the
   * selection that row stores: `chooseSelector` picks the named, stored, or
   * default selector, `chooseEffort` follows the spec's order, and
   * `nextSelectionForWrite` decides whether an owner request stores the
   * result. A held Chat resolves to its held model in the hold layer; this
   * layer ignores `hold` entirely.
   */
  resolveSelection(
    stored: ChatModelSelection | null,
    request: SelectionRequest,
    writer: SelectionWriter,
  ): ResolvedSelection {
    return resolveSelectionFromCatalog(
      this.selectionCatalog,
      stored,
      request,
      writer,
    );
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
   * The published role table. `paid` comes from the internal catalog entry
   * because `toPublicModel` strips `billing`; only per-token (`usage`) billing
   * is paid, so a `subscription` or `free` candidate is not.
   */
  private modelRoles(): Array<ModelRoleAvailability> {
    return this.instanceConfig.config.modelRoles.map((role) => ({
      selector: `${ROLE_SIGN}${role.name}`,
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
