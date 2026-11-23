/**
 * The composer's model selection: the Chat's stored selection overlaid with
 * the owner's unsent picks, and the model and effort the next send resolves
 * from it. The picker, the effort control, the send bodies, and the
 * attachment capabilities all read this one derivation.
 *
 * See OpenSpec `model-roles`: "A selector resolves to one model at
 * admission", "An omitted effort follows one order", and
 * "The web picker shows the stored selection".
 */

import type {
  AvailableModelResponse,
  ChatFallbackHoldResponse,
  ChatModelSelectionResponse,
  ModelsResponse,
} from "../../api/generated/models";

/** The selection the composer shows: the Chat's stored one, or the catalog's
 *  `defaultSelector` for a Chat that stores none. */
export type ComposerSelection = ChatModelSelectionResponse;

/** The owner's unsent picks: a selector picked in the picker, an effort
 *  picked on the effort control, or neither. */
export type SelectionPicks = {
  readonly selector?: string | undefined;
  readonly effort?: string | undefined;
};

/**
 * The fields one send names. `undefined` means the field is absent from the
 * body, so the api resolves the Chat's stored selection instead.
 */
export type SendSelection = {
  readonly selector?: string | undefined;
  readonly effort?: string | undefined;
  /** A model the displayed selection resolves to exists. */
  readonly ready: boolean;
};

/** The catalog's own selection for a Chat that stores none. */
export function defaultComposerSelection(
  data: ModelsResponse,
): ComposerSelection {
  return { selector: data.defaultSelector, effort: null };
}

/** The role entry a selector names, when it is one. */
function roleCandidates(
  data: ModelsResponse,
  selector: string,
): ModelsResponse["roles"][number]["candidates"] | undefined {
  if (!selector.startsWith("@")) return undefined;

  return data.roles.find((role) => role.selector === selector)?.candidates;
}

/** Whether the catalog offers `selector` at all — a role with a resolvable
 *  primary candidate, or a model id it lists. */
function selectorOffered(selector: string, data: ModelsResponse): boolean {
  const candidates = roleCandidates(data, selector);

  if (candidates !== undefined) {
    const primary = candidates[0];

    return (
      primary !== undefined &&
      data.models.some((model) => model.id === primary.modelId)
    );
  }

  return data.models.some((model) => model.id === selector);
}

/**
 * The stored selection to show, falling back to the catalog default when the
 * Chat stores a selector the config no longer offers — the same fallback
 * admission takes ("A stored selection that no longer resolves uses the
 * default"). Without a catalog, the stored selection shows as-is.
 */
function storedSelection(
  stored: ChatModelSelectionResponse | null | undefined,
  data: ModelsResponse | undefined,
): ComposerSelection | null {
  if (data === undefined) return stored ?? null;

  if (
    stored !== null &&
    stored !== undefined &&
    selectorOffered(stored.selector, data)
  ) {
    return stored;
  }

  return defaultComposerSelection(data);
}

/**
 * The selection the composer shows: the Chat's stored one (or the catalog
 * default), overlaid with the owner's picks. A selector pick starts a new
 * selection, so it drops the stored effort and hold; an effort pick keeps the
 * rest of the selection.
 */
export function composerSelection(
  stored: ChatModelSelectionResponse | null | undefined,
  data: ModelsResponse | undefined,
  picks: SelectionPicks = {},
): ComposerSelection | null {
  const base = storedSelection(stored, data);

  if (base === null) return null;

  if (picks.selector !== undefined) {
    return { selector: picks.selector, effort: picks.effort ?? null };
  }

  return picks.effort === undefined ? base : { ...base, effort: picks.effort };
}

/**
 * The fallback hold that applies right now: its role is the selected one, its
 * `revertAt` is still ahead on the local clock, and its model is still a
 * candidate of that role. Any other hold is spent.
 */
export function applicableHold(
  selection: ComposerSelection,
  data: ModelsResponse | undefined,
  now: Date = new Date(),
): ChatFallbackHoldResponse | undefined {
  const hold = selection.hold;

  if (hold === undefined || data === undefined) return undefined;

  if (hold.selector !== selection.selector) return undefined;
  const revertAt = Date.parse(hold.revertAt);

  if (!Number.isFinite(revertAt) || revertAt <= now.getTime()) {
    return undefined;
  }

  const candidates = roleCandidates(data, hold.selector) ?? [];

  return candidates.some(({ modelId }) => modelId === hold.modelId)
    ? hold
    : undefined;
}

/** The model id a selector resolves to: the held model, the role's primary
 *  candidate, or the exact model. */
function selectorModelId(
  selection: ComposerSelection,
  data: ModelsResponse,
  now: Date,
): string | undefined {
  const hold = applicableHold(selection, data, now);

  if (hold !== undefined) return hold.modelId;

  const candidates = roleCandidates(data, selection.selector);

  if (candidates !== undefined) return candidates[0]?.modelId;

  return data.models.some(({ id }) => id === selection.selector)
    ? selection.selector
    : undefined;
}

/**
 * The model the next send would use: the held model while the hold applies,
 * the first candidate of a role, or the exact model. Undefined when the
 * catalog does not resolve the selector (so Send stays disabled).
 */
export function resolveDisplayedModel(
  selection: ComposerSelection | null | undefined,
  data: ModelsResponse | undefined,
  now: Date = new Date(),
): AvailableModelResponse | undefined {
  if (selection === null || selection === undefined || data === undefined) {
    return undefined;
  }

  const modelId = selectorModelId(selection, data, now);

  return data.models.find(({ id }) => id === modelId);
}

/** The role candidate the selection resolves through, when it is a role. */
function resolvedCandidate(
  selection: ComposerSelection,
  data: ModelsResponse,
  modelId: string,
): ModelsResponse["roles"][number]["candidates"][number] | undefined {
  return roleCandidates(data, selection.selector)?.find(
    (candidate) => candidate.modelId === modelId,
  );
}

/**
 * The effort the composer shows and the next send would resolve for `model`,
 * in the api's order: the owner's unsent pick, the hold's effort while it
 * applies, else the stored effort, then the role candidate's effort, then the
 * model's `defaultEffort`. A level the model does not declare never applies —
 * the api would refuse it.
 */
export function resolveDisplayedEffort(input: {
  selection: ComposerSelection | null | undefined;
  model: AvailableModelResponse | undefined;
  pickedEffort: string | undefined;
  data: ModelsResponse | undefined;
  now: Date;
}): string | undefined {
  const { selection, model, pickedEffort, data, now } = input;

  if (
    selection === null ||
    selection === undefined ||
    data === undefined ||
    model === undefined
  ) {
    return undefined;
  }

  const levels = model.reasoning?.effortLevels ?? [];

  const declares = (effort: string | null | undefined): effort is string =>
    effort !== null &&
    effort !== undefined &&
    levels.some((level) => level.value === effort);

  const hold = applicableHold(selection, data, now);
  const own = hold !== undefined ? hold.effort : selection.effort;
  const candidate = resolvedCandidate(selection, data, model.id);

  return (
    [pickedEffort, own, candidate?.effort].find(declares) ??
    model.reasoning?.defaultEffort
  );
}

/**
 * The fields the next send names. On a Chat's first message (a new Chat) the
 * send names the selection the composer shows; on an existing Chat it names
 * only the owner's picks, so the stored selection applies otherwise.
 */
export function resolveSendSelection(input: {
  selection: ComposerSelection | null;
  model: AvailableModelResponse | undefined;
  firstSend: boolean;
  picks: SelectionPicks;
  shownEffort: string | undefined;
}): SendSelection {
  const { model, selection } = input;

  if (model === undefined || selection === null) return { ready: false };

  const levels = model.reasoning?.effortLevels ?? [];

  const declares = (effort: string | undefined): effort is string =>
    effort !== undefined && levels.some((level) => level.value === effort);

  if (input.firstSend) {
    return {
      selector: selection.selector,
      ...(declares(input.shownEffort) && { effort: input.shownEffort }),
      ready: true,
    };
  }

  return {
    ...(input.picks.selector !== undefined && {
      selector: input.picks.selector,
    }),
    ...(declares(input.picks.effort) && { effort: input.picks.effort }),
    ready: true,
  };
}

/**
 * The selection an accepted send stores, for the composer to show until the
 * Chat read catches up. `null` when the send named nothing, so the stored
 * selection still stands.
 */
export function acceptedSelectionFor(input: {
  send: SendSelection;
  selection: ComposerSelection | null;
  shownEffort: string | undefined;
  data: ModelsResponse | undefined;
  now: Date;
}): ChatModelSelectionResponse | null {
  const { send, selection, shownEffort } = input;

  if (selection === null) return null;

  if (send.selector === undefined && send.effort === undefined) return null;
  const effort = send.effort ?? shownEffort ?? null;

  if (send.selector === undefined) {
    // An effort-only request keeps the hold ("An owner pick clears the
    // hold" covers selectors only); under an applied hold, the api pins the
    // effort on the hold and leaves the owner's effort alone.
    const hold = applicableHold(selection, input.data, input.now);

    return hold === undefined
      ? { ...selection, effort }
      : { ...selection, hold: { ...hold, effort: send.effort ?? null } };
  }

  return { selector: send.selector, effort };
}

/** A `revertAt` instant on the reader's own clock, as `HH:MM`. */
export function localTimeOf(instant: string): string {
  const date = new Date(instant);

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
