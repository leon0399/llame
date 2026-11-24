import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';

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
import { ROLE_SIGN, parseModelSelector } from './model-selector';
import {
  chooseEffort,
  chooseSelector,
  nextCandidateInRole,
  nextSelectionForWrite,
  offerSelector,
  resolveHold,
  type ChatModelSelection,
  type HoldResolution,
  type NextCandidate,
  type OfferedSelector,
  type SelectionCatalog,
  type SelectionRequest,
  type SelectionWriter,
  type SelectorChoice,
} from './model-selection';

export type TitleModelCandidates = {
  readonly models: ReadonlyArray<SystemModelCatalogEntry>;
  readonly allowPaidFallback: boolean;
};

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
 * The next-candidate action has nothing to move to (design D7): an exact
 * selector, a compaction Run, a role without a following candidate, a model the
 * role no longer lists, or a Run in the wrong state. An HTTP exception because
 * every caller answers it directly — 409 with a stable `code`, like the 422
 * model errors, and the follow-up admission's refusal check already treats an
 * `HttpException` as a value it can answer after its transaction commits.
 */
export class NextCandidateUnavailableError extends HttpException {
  readonly code = 'next_candidate_unavailable';

  constructor(message = 'No next model candidate is available for this Run.') {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message,
        code: 'next_candidate_unavailable',
      },
      HttpStatus.CONFLICT,
    );
    this.name = 'NextCandidateUnavailableError';
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
 * catalog (or the held one, while a fallback hold applies); the effort follows
 * "An omitted effort follows one order"; the mode is enabled. Every admission
 * path — a send, chat creation, Regenerate, `/compact`, a delivery start, queue
 * promotion, and a job notice — shares this one check, so a pending item starts
 * only under settings a send would be accepted with now.
 *
 * `now` is the transaction's clock: a fallback hold applies only while its
 * `revertAt` is ahead of it, and any admission drops one that is not.
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
    /** The admission transaction's `now()`. */
    now: Date;
  },
): ResolvedSendSettings {
  const selection = models.resolveSelection(
    input.stored,
    input.request,
    input.writer,
    input.now,
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

/** One admission, as the shared resolver reads it. */
export type SelectionAdmission = {
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  writer: SelectionWriter;
  /** The admission transaction's `now()`. */
  now: Date;
};

/** The selector a resolution settled on, or its refusal as a domain error. */
export function requireOfferedSelector(
  chosen: SelectorChoice,
): OfferedSelector {
  if (chosen.kind === 'unknown') {
    throw new ModelNotAvailableError(chosen.selector);
  }

  if (chosen.kind === 'no-default') {
    throw new ModelConfigurationError(DEFAULT_SELECTOR_REQUIRED);
  }

  if (chosen.kind === 'unresolved-default') {
    throw new ModelConfigurationError(DEFAULT_SELECTOR_REFERENCE);
  }

  return chosen;
}

/**
 * Resolve one selection against a catalog, mapping each refusal to its domain
 * error (design D3). It lives beside the errors it raises, so the worker test
 * harnesses resolve a selector through the same rules the API does instead of
 * restating them.
 *
 * The hold comes after the selector, because whether it applies depends on the
 * stored selector being the one that resolved: an applied hold serves the Run
 * on its model, with its effort (design D4), and a dropped one is cleared by
 * the write this returns.
 */
export function resolveSelectionFromCatalog(
  catalog: SelectionCatalog,
  admission: SelectionAdmission,
): ResolvedSelection {
  const { stored, request, writer, now } = admission;

  const chosen = requireOfferedSelector(
    chooseSelector(catalog, stored, request),
  );

  const hold = resolveHold({
    catalog,
    stored,
    request,
    writer,
    storedUsed: chosen.storedUsed,
    now,
  });

  const applied = hold.kind === 'applied' ? hold : undefined;

  const model = applied?.model ?? chosen.model;

  const effort = admittedEffort({ model, request, applied, chosen, stored });

  return {
    selector: chosen.selector,
    model,
    effort,
    nextSelection: nextSelectionForWrite({
      stored,
      request,
      writer,
      selector: chosen.selector,
      effort,
      storedUsed: chosen.storedUsed,
      hold,
    }),
  };
}

/** An applied fallback hold: the held model serves this admission. */
type AppliedHold = Extract<HoldResolution, { kind: 'applied' }>;

/**
 * level is refused when the resolved model does not declare it. A job notice
 * under an applied hold uses the hold's effort instead of its recorded effort.
 * Otherwise it follows the same named-effort and candidate/default chain.
 */
function admittedEffort(input: {
  model: SystemModelCatalogEntry;
  request: SelectionRequest;
  applied: AppliedHold | undefined;
  chosen: OfferedSelector;
  stored: ChatModelSelection | null;
}): string | undefined {
  const preferred = input.request.effortPolicy === 'preferred';

  return resolveEffortChoice({
    model: input.model,
    // A recorded notice effort is omitted only when a hold applies.
    requested:
      preferred && input.applied !== undefined
        ? undefined
        : input.request.effort,
    holdEffort: input.applied?.hold.effort,
    // Otherwise it is validated like an owner-named level.
    storedEffort: preferred
      ? null
      : input.chosen.storedUsed
        ? (input.stored?.effort ?? null)
        : null,
    candidateEffort:
      input.applied?.candidate.effort ?? input.chosen.candidate?.effort,
  });
}

/**
 * The effort a resolution settles on, or its refusal as a domain error: a
 * named level the resolved model does not declare is a 422.
 */
function resolveEffortChoice(input: {
  model: SystemModelCatalogEntry;
  requested: string | undefined;
  holdEffort: string | null | undefined;
  storedEffort: string | null;
  candidateEffort: string | undefined;
}): string | undefined {
  const choice = chooseEffort(input);

  if (choice.kind === 'undeclared') {
    throw new EffortNotAvailableError(input.model.id, choice.effort);
  }

  return choice.kind === 'effort' ? choice.effort : undefined;
}

/** The only capability a run needs to obtain a client (#268). */
export type ModelClientFactory = Pick<ModelsService, 'createClient'>;

/** The only capability the admission paths need to resolve a selection (#268). */
export type ModelSelectionValidator = Pick<
  ModelsService,
  'validateModelSelection' | 'resolveEffortSelection' | 'resolveSelection'
> &
  Partial<Pick<ModelsService, 'nextCandidate'>>;

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

  resolveTitleModelCandidates(): TitleModelCandidates | undefined {
    const selector =
      this.instanceConfig.config.defaults.titleGenerationSelector;

    if (selector === null) return undefined;

    const parsed = parseModelSelector(selector);

    if (parsed.kind === 'role') {
      const role = this.rolesByName.get(parsed.roleName);

      if (role === undefined) return undefined;

      return {
        models: role.candidates.flatMap((candidate) => {
          const model = this.modelsById.get(candidate.modelId);

          return model === undefined ? [] : [model];
        }),
        allowPaidFallback: role.allowPaidFallback === true,
      };
    }

    const model = this.modelsById.get(parsed.modelId);

    return model === undefined
      ? undefined
      : { models: [model], allowPaidFallback: false };
  }

  requireAvailableModel(modelId: string): SystemModelCatalogEntry {
    const model = this.modelsById.get(modelId);

    if (!model) {
      throw new ModelNotAvailableError(modelId);
    }

    return model;
  }

  /**
   * The availability half of a selection, and nothing else: admission has
   * already resolved the selector (and with it any default rule) before a Run
   * exists, so the worker, Continue, and promotion only re-check that the
   * selected id is still in the catalog. A missing default must not fail a Run
   * that named an exact model or reused a stored selection.
   */
  validateModelSelection(modelId: string): SystemModelCatalogEntry {
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
   * The candidate after `currentModelId` in the role that `selector` names,
   * read from the config this instance booted with (design D7). `undefined`
   * for an exact selector, an unknown role, a model the role does not list,
   * and the last candidate — the chain never wraps.
   */
  nextCandidate(
    selector: string,
    currentModelId: string,
  ): NextCandidate | undefined {
    return nextCandidateInRole(this.selectionCatalog, selector, currentModelId);
  }

  /**
   * Resolve one admission's selector, model, and effort (design D3). The
   * caller runs it inside the transaction that holds the Chat row, with the
   * selection that row stores and that transaction's `now()`: `chooseSelector`
   * picks the named, stored, or default selector, `resolveHold` decides whether
   * a fallback hold applies or is dropped (design D4), and `chooseEffort`
   * resolves effort. A notice's hold supersedes its recorded effort; otherwise
   * that effort is validated like an owner-named level.
   */
  resolveSelection(
    stored: ChatModelSelection | null,
    request: SelectionRequest,
    writer: SelectionWriter,
    now: Date,
  ): ResolvedSelection {
    return resolveSelectionFromCatalog(this.selectionCatalog, {
      stored,
      request,
      writer,
      now,
    });
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
