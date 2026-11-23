/**
 * The model selection a Chat stores (`chats.model_selection`) and the shapes
 * admission resolves it into. See OpenSpec `model-roles`: "The Chat stores its
 * selection", "Owner requests write the selection", "An omitted effort follows
 * one order", "The Chat returns to the primary after revertAt", and "An owner
 * pick clears the hold".
 */

import type { ModelRoleCandidate } from '../instance-config/model-roles-config';
import type { SystemModelCatalogEntry } from './model-catalog';
import { parseModelSelector } from './model-selector';

/** A fallback hold: the Chat stays on `modelId` for role `selector` until `revertAt`. */
export type ChatFallbackHold = {
  readonly selector: string;
  readonly modelId: string;
  readonly effort: string | null;
  /** ISO 8601 instant. */
  readonly revertAt: string;
};

export type ChatModelSelection = {
  /** Increases by one on every owner write; a Run records the value it read. */
  readonly revision: number;
  /** `@role` or an exact model id. */
  readonly selector: string;
  /** The effort the owner's selection stores, or `null` for none. */
  readonly effort: string | null;
  readonly hold?: ChatFallbackHold;
};

/**
 * What one request names. The named fields are optional.
 *
 * `effortPolicy` is admission metadata, not something the owner names: it says
 * whether `effort` is a named level or only a preference recorded from another
 * Run. It is omitted for every owner request.
 */
export type SelectionRequest = {
  readonly selector?: string | undefined;
  readonly effort?: string | undefined;
  readonly effortPolicy?: EffortPolicy | undefined;
};

/**
 * `owner`: a send (any delivery mode), chat creation, Regenerate, or `/compact`;
 * it may write the selection. `derived`: Continue, queue promotion, or a
 * job-notice Run; it never writes the owner's selector or effort.
 */
export type SelectionWriter = 'owner' | 'derived';

/**
 * How admission reads a request's `effort`. `named`: the owner named it, so an
 * undeclared level refuses the request. `preferred`: a job notice recorded the
 * effort of the Run that started the job; admission uses it when the resolved
 * model declares it and otherwise follows the candidate/default chain, so a
 * preference never keeps a notice pending.
 */
export type EffortPolicy = 'named' | 'preferred';

/**
 * The catalog facts a selection resolves against. `ModelsService` implements
 * it over its boot maps and `defaults.selector`.
 */
export type SelectionCatalog = {
  /** `defaults.selector`, or undefined when the operator left it unset. */
  readonly defaultSelector: string | undefined;
  /** The role's candidates, primary first; undefined when the role is unknown. */
  roleCandidates(
    roleName: string,
  ): ReadonlyArray<ModelRoleCandidate> | undefined;
  /** The configured model, or undefined when the catalog does not offer it. */
  model(modelId: string): SystemModelCatalogEntry | undefined;
};

/** The selector a resolution settles on, before its effort is chosen. */
export type SelectorChoice =
  | { readonly kind: 'unknown'; readonly selector: string }
  | { readonly kind: 'no-default' }
  | { readonly kind: 'unresolved-default' }
  | {
      readonly kind: 'selector';
      readonly selector: string;
      readonly model: SystemModelCatalogEntry;
      /** The role candidate the selector resolved through, if it is a role. */
      readonly candidate: ModelRoleCandidate | undefined;
      /** Whether the Chat's stored selector was the one that resolved. */
      readonly storedUsed: boolean;
    };

/** A selector the catalog offers, with the model and role candidate it names. */
export type OfferedSelector = Extract<SelectorChoice, { kind: 'selector' }>;

/**
 * The selector a catalog offers, or `undefined` when it does not. This is the
 * one role→primary rule: a role resolves through its first configured
 * candidate, and `ModelsService` resolves its default and title selectors
 * through this same call, so no second "first candidate" rule can drift.
 */
export function offerSelector(
  catalog: SelectionCatalog,
  selector: string,
): OfferedSelector | undefined {
  const parsed = parseModelSelector(selector);

  if (parsed.kind === 'model') {
    const model = catalog.model(parsed.modelId);

    return model === undefined
      ? undefined
      : {
          kind: 'selector',
          selector,
          model,
          candidate: undefined,
          storedUsed: false,
        };
  }

  // This layer stops at the primary candidate; walking the rest of the chain
  // is a later layer's job.
  const candidate = catalog.roleCandidates(parsed.roleName)?.[0];

  const model =
    candidate === undefined ? undefined : catalog.model(candidate.modelId);

  return model === undefined
    ? undefined
    : { kind: 'selector', selector, model, candidate, storedUsed: false };
}

/**
 * The selector one request resolves to, in the spec's order: the one it names,
 * the one the Chat stores while the config still offers it, `defaults.selector`.
 * A named selector that does not resolve is `unknown` (422); a stored one that
 * no longer does falls through to the default, as "a stored selection that no
 * longer resolves uses the default" requires. Nothing here throws: the caller
 * maps each kind to its own error.
 */
export function chooseSelector(
  catalog: SelectionCatalog,
  stored: ChatModelSelection | null,
  request: SelectionRequest,
): SelectorChoice {
  if (request.selector !== undefined) {
    return (
      offerSelector(catalog, request.selector) ?? {
        kind: 'unknown',
        selector: request.selector,
      }
    );
  }

  if (stored !== null) {
    const offered = offerSelector(catalog, stored.selector);

    if (offered !== undefined) {
      return { ...offered, storedUsed: true };
    }
  }

  const fallback = catalog.defaultSelector;

  if (fallback === undefined) return { kind: 'no-default' };

  // Boot validates a set `defaults.selector`, so an unresolved one is a broken
  // configuration (503), never the request's 422.
  return offerSelector(catalog, fallback) ?? { kind: 'unresolved-default' };
}

/** The effort a resolution settles on, before it becomes a Run's effort. */
export type EffortChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'undeclared'; readonly effort: string }
  | { readonly kind: 'effort'; readonly effort: string };

/**
 * What the Chat's fallback hold does on one admission: it applies (the Chat
 * stays on the held model), it is dropped (the request replaced it, or its
 * `revertAt` passed, or its model left the role), or the Chat holds none.
 */
export type HoldResolution =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'applied';
      readonly hold: ChatFallbackHold;
      /** The held model, which serves the Run instead of the role's primary. */
      readonly model: SystemModelCatalogEntry;
      /** The held model's role candidate, whose effort may still apply. */
      readonly candidate: ModelRoleCandidate;
    }
  | { readonly kind: 'dropped' };

/**
 * The hold's outcome for one request, decided before the effort and the write:
 * a hold applies only when the request names no selector, the stored selection
 * is the one that resolves, the hold names that same selector, `revertAt` is
 * still ahead of the transaction's clock, and its model is still a candidate of
 * the role. An admission drops it only when `revertAt` passed or its model left
 * the role, the two cases every creator must clear. An owner request that names
 * a selector also drops it, because the pick replaced the selection the hold
 * belonged to. A derived creator never writes the owner's choice: when its own
 * selector means the hold does not serve this Run, the hold stays as stored.
 */
export function resolveHold(input: {
  catalog: SelectionCatalog;
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  writer: SelectionWriter;
  /** Whether {@link chooseSelector} settled on the Chat's stored selector. */
  storedUsed: boolean;
  /** The admission transaction's `now()`. */
  now: Date;
}): HoldResolution {
  const hold = input.stored?.hold;

  if (hold === undefined) return { kind: 'none' };

  // `Date.parse` answers NaN for a malformed instant, and `NaN > now` is false,
  // so a hold that cannot be read behaves like one that passed.
  const expired = !(Date.parse(hold.revertAt) > input.now.getTime());

  const parsed = parseModelSelector(hold.selector);

  const candidate =
    parsed.kind === 'role'
      ? input.catalog
          .roleCandidates(parsed.roleName)
          ?.find((entry) => entry.modelId === hold.modelId)
      : undefined;

  const model = candidate && input.catalog.model(hold.modelId);

  if (expired || candidate === undefined || model === undefined) {
    return { kind: 'dropped' };
  }

  const applies =
    input.request.selector === undefined &&
    input.storedUsed &&
    hold.selector === input.stored?.selector;

  if (!applies) {
    return input.writer === 'owner' ? { kind: 'dropped' } : { kind: 'none' };
  }

  return { kind: 'applied', hold, model, candidate };
}

/** The last two steps of the effort order: the candidate's, then the model's. */
function fallbackEffort(
  model: SystemModelCatalogEntry,
  candidateEffort: string | undefined,
): EffortChoice {
  if (candidateEffort !== undefined) {
    return { kind: 'effort', effort: candidateEffort };
  }

  const fallback = model.reasoning?.defaultEffort;

  return fallback === undefined
    ? { kind: 'none' }
    : { kind: 'effort', effort: fallback };
}

/**
 * The effort one request resolves to, in the spec's order: the one it names,
 * the effort of an applied fallback hold (which replaces the stored effort for
 * this admission), the stored effort (only when the request named no selector
 * and the stored selector resolved), the role candidate's effort, the model's
 * default.
 *
 * Matching is byte-exact: the levels are opaque provider tokens. A named level
 * on a model that declares none is `undeclared` (422), which is also why a
 * non-reasoning model ends at `none` when the request names no effort. A level
 * that is only a preference falls through to the later steps instead.
 */
export function chooseEffort(input: {
  model: SystemModelCatalogEntry;
  requested: string | undefined;
  /** Whether `requested` may be ignored when the model does not declare it. */
  requestedIsPreference?: boolean;
  /** The stored effort, already narrowed to "applies to this request". */
  storedEffort: string | null;
  /** The resolved role candidate's effort, when it resolved through a role. */
  candidateEffort: string | undefined;
  /**
   * The effort an applied hold pins, or `null` when it pins none. Undefined
   * unless a hold applied; then the stored effort is not consulted at all.
   */
  holdEffort?: string | null;
}): EffortChoice {
  const levels = input.model.reasoning?.effortLevels;

  if (input.requested !== undefined) {
    if (levels?.some((level) => level.value === input.requested) === true) {
      return { kind: 'effort', effort: input.requested };
    }

    if (input.requestedIsPreference !== true) {
      return { kind: 'undeclared', effort: input.requested };
    }
  }

  if (input.holdEffort !== undefined) {
    if (
      input.holdEffort !== null &&
      levels?.some((level) => level.value === input.holdEffort) === true
    ) {
      return { kind: 'effort', effort: input.holdEffort };
    }

    return fallbackEffort(input.model, input.candidateEffort);
  }

  if (
    input.storedEffort !== null &&
    levels?.some((level) => level.value === input.storedEffort) === true
  ) {
    return { kind: 'effort', effort: input.storedEffort };
  }

  return fallbackEffort(input.model, input.candidateEffort);
}

/**
 * The selection a request stores, or undefined when it writes none.
 *
 * An owner request writes when it changes something — it named a selector or
 * an effort, it resolved without a usable stored selection, or its hold was
 * dropped — and every such write bumps the revision. A named selector drops
 * the hold (a pick replaces the selection the hold belonged to); an effort
 * named under an applied hold pins that effort on the hold and leaves the
 * owner's selector and effort alone.
 *
 * A derived creator writes one thing and one thing only: the removal of a hold
 * its admission dropped. It writes the stored selector and stored effort, at
 * the stored revision, without the hold; it never writes the selector or effort
 * the item named.
 */
export function nextSelectionForWrite(input: {
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  writer: SelectionWriter;
  selector: string;
  effort: string | undefined;
  storedUsed: boolean;
  hold: HoldResolution;
}): ChatModelSelection | undefined {
  const dropped = input.hold.kind === 'dropped';

  if (input.writer !== 'owner') {
    if (!dropped || input.stored === null) return undefined;

    return {
      revision: input.stored.revision,
      selector: input.stored.selector,
      effort: input.stored.effort,
    };
  }

  const namedSelector = input.request.selector !== undefined;
  const namedEffort = input.request.effort !== undefined;

  // Nothing named, the stored selection resolved, and its hold (if any) still
  // applies: this request has nothing to store.
  if (!namedSelector && !namedEffort && input.storedUsed && !dropped) {
    return undefined;
  }

  const applied = input.hold.kind === 'applied' ? input.hold.hold : undefined;

  if (applied !== undefined && !namedSelector && input.stored !== null) {
    return {
      revision: input.stored.revision + 1,
      selector: input.stored.selector,
      effort: input.stored.effort,
      hold: { ...applied, effort: input.effort ?? null },
    };
  }

  return {
    revision: (input.stored?.revision ?? 0) + 1,
    selector: input.selector,
    effort: input.effort ?? null,
  };
}
