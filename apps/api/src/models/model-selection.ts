/**
 * The model selection a Chat stores (`chats.model_selection`) and the shapes
 * admission resolves it into. See OpenSpec `model-roles`: "The Chat stores its
 * selection", "Owner requests write the selection", "An omitted effort follows
 * one order".
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

/** What one request names. Both fields are optional. */
export type SelectionRequest = {
  readonly selector?: string | undefined;
  readonly effort?: string | undefined;
};

/**
 * `owner`: a send (any delivery mode), chat creation, Regenerate, or `/compact`;
 * it may write the selection. `derived`: Continue, queue promotion, or a
 * job-notice Run; it never writes the owner's selector or effort.
 */
export type SelectionWriter = 'owner' | 'derived';

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
 * The effort one request resolves to, in the spec's order: the one it names,
 * the stored effort (only when the request named no selector and the stored
 * selector resolved), the role candidate's effort, the model's default.
 *
 * Matching is byte-exact: the levels are opaque provider tokens. A named level
 * on a model that declares none is `undeclared` (422), which is also why a
 * non-reasoning model ends at `none` when the request names no effort.
 */
export function chooseEffort(input: {
  model: SystemModelCatalogEntry;
  requested: string | undefined;
  /** The stored effort, already narrowed to "applies to this request". */
  storedEffort: string | null;
  /** The resolved role candidate's effort, when it resolved through a role. */
  candidateEffort: string | undefined;
}): EffortChoice {
  const levels = input.model.reasoning?.effortLevels;

  if (input.requested !== undefined) {
    return levels?.some((level) => level.value === input.requested) === true
      ? { kind: 'effort', effort: input.requested }
      : { kind: 'undeclared', effort: input.requested };
  }

  if (
    input.storedEffort !== null &&
    levels?.some((level) => level.value === input.storedEffort) === true
  ) {
    return { kind: 'effort', effort: input.storedEffort };
  }

  if (input.candidateEffort !== undefined) {
    return { kind: 'effort', effort: input.candidateEffort };
  }

  const fallback = input.model.reasoning?.defaultEffort;

  return fallback === undefined
    ? { kind: 'none' }
    : { kind: 'effort', effort: fallback };
}

/**
 * The selection a request stores, or undefined when it writes none. Only an
 * owner request writes, and only when it changes something: it named a
 * selector or an effort, or it resolved without a usable stored selection.
 *
 * An effort-only request keeps the stored hold untouched (this layer never
 * applies a hold); any request that names a selector drops it, because a pick
 * replaces the selection the hold belonged to.
 */
export function nextSelectionForWrite(input: {
  stored: ChatModelSelection | null;
  request: SelectionRequest;
  writer: SelectionWriter;
  selector: string;
  effort: string | undefined;
  storedUsed: boolean;
}): ChatModelSelection | undefined {
  if (input.writer !== 'owner') return undefined;

  const namedSelector = input.request.selector !== undefined;
  const namedEffort = input.request.effort !== undefined;

  if (!namedSelector && !namedEffort && input.storedUsed) return undefined;

  const hold = namedEffort && !namedSelector ? input.stored?.hold : undefined;

  return {
    revision: (input.stored?.revision ?? 0) + 1,
    selector: input.selector,
    effort: input.effort ?? null,
    ...(hold !== undefined && { hold }),
  };
}
