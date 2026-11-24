"use client";

import * as React from "react";

import { useChatContext } from "@/contexts/chat-context";
import type {
  ChatFallbackHoldResponse,
  ModelRoleResponse,
} from "@/lib/api/generated/models";
import {
  type AvailableModel,
  type ModelsResponse,
  useModelsQuery,
} from "@/lib/services/models/queries";
import { NO_ROLES } from "@/lib/services/models/next-candidate";
import {
  acceptedSelectionFor,
  applicableHold,
  composerSelection,
  resolveDisplayedEffort,
  resolveDisplayedModel,
  resolveSendSelection,
  type ComposerSelection,
  type SendSelection,
} from "@/lib/services/models/selection";

/** Stable empty sentinel — `?? []` would allocate a new array every render
 *  and defeat memoized transcript rows while models are still loading. */
const EMPTY_MODELS: ReadonlyArray<AvailableModel> = [];

const MAX_TIMEOUT_DELAY = 2_147_483_647;

export type ComposerSelectionState = {
  data: ModelsResponse | undefined;
  /** The selection the picker shows (stored selection plus unsent picks). */
  selection: ComposerSelection | null;
  /** The fallback hold that applies to `selection` right now, if any. */
  hold: ChatFallbackHoldResponse | undefined;
  /** The model the next send resolves to; undefined when no valid selection. */
  model: AvailableModel | undefined;
  /** The effort the composer shows for `model`. */
  effort: string | undefined;
  /** The fields the next send names, and whether it may send at all. */
  send: SendSelection;
  /** The selection an accepted send stores, for the composer to show until
   *  the Chat read catches up; null when the send named nothing. */
  accepted: ComposerSelection | null;
  availableModels: ReadonlyArray<AvailableModel>;
  /** The configured model roles, which decide whether a failed role Run
   *  offers its next candidate. */
  roles: ReadonlyArray<ModelRoleResponse>;
  modelReadyForSend: boolean;
  modelSendUnavailableReason: string | null;
};

/** Why the composer cannot send, from the catalog query and the selection. */
function sendUnavailableReason(
  query: { isPending: boolean; isError: boolean },
  availableModels: ReadonlyArray<AvailableModel>,
  ready: boolean,
): string | null {
  if (query.isPending) return null;

  if (query.isError) {
    return "Models could not be loaded; chat sending is unavailable.";
  }

  if (availableModels.length === 0) {
    return "No chat models are configured; chat sending is unavailable.";
  }

  if (!ready) return "Select an available model to send.";

  return null;
}

function composerReadiness(
  query: { isPending: boolean; isError: boolean; isSuccess: boolean },
  data: ModelsResponse | undefined,
  sendReady: boolean,
): Pick<
  ComposerSelectionState,
  "availableModels" | "modelReadyForSend" | "modelSendUnavailableReason"
> {
  const availableModels = data?.models ?? EMPTY_MODELS;

  return {
    availableModels,
    modelReadyForSend: query.isSuccess && sendReady,
    modelSendUnavailableReason: sendUnavailableReason(
      query,
      availableModels,
      sendReady,
    ),
  };
}

type DerivedSelection = {
  selection: ComposerSelection | null;
  hold: ChatFallbackHoldResponse | undefined;
  model: AvailableModel | undefined;
  effort: string | undefined;
  send: SendSelection;
  accepted: ComposerSelection | null;
};

type DeriveArgs = {
  data: ModelsResponse | undefined;
  displayedSelection: ComposerSelection | null;
  pickedSelector: string | undefined;
  pickedEffort: string | undefined;
  firstSend: boolean;
  now: Date;
};

type DisplaySelection = Pick<
  DerivedSelection,
  "selection" | "hold" | "model" | "effort"
>;

/** Resolve the shown selector, model, and effort from one shared clock. */
function displaySelection(args: DeriveArgs): DisplaySelection {
  const selection = composerSelection(args.displayedSelection, args.data, {
    selector: args.pickedSelector,
    effort: args.pickedEffort,
  });

  const hold =
    selection === null
      ? undefined
      : applicableHold(selection, args.data, args.now);

  const model = resolveDisplayedModel(selection, args.data, args.now);

  const effort = resolveDisplayedEffort({
    selection,
    model,
    pickedEffort: args.pickedEffort,
    data: args.data,
    now: args.now,
  });

  return { selection, hold, model, effort };
}

/** Derive the composer selection and what its next request names. */
function deriveSelection(args: DeriveArgs): DerivedSelection {
  const displayed = displaySelection(args);

  const send = resolveSendSelection({
    selection: displayed.selection,
    model: displayed.model,
    firstSend: args.firstSend,
    picks: { selector: args.pickedSelector, effort: args.pickedEffort },
    shownEffort: displayed.effort,
  });

  return {
    ...displayed,
    send,
    accepted: acceptedSelectionFor({
      send,
      selection: displayed.selection,
      shownEffort: displayed.effort,
      data: args.data,
      now: args.now,
    }),
  };
}

/**
 * Clock that re-derives selection when a stored hold reaches its expiry. A
 * hold that is already past when it arrives (a stale refresh, a throttled tab)
 * advances the clock on the next tick, so it is never applied for longer.
 */
export function useHoldExpiryClock(revertAt: string | undefined): number {
  const [clock, setClock] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (revertAt === undefined) return;

    const expiry = Date.parse(revertAt);

    if (clock >= expiry) return;

    const delay = Math.min(Math.max(expiry - Date.now(), 0), MAX_TIMEOUT_DELAY);
    const timer = window.setTimeout(() => setClock(Date.now()), delay);

    return () => window.clearTimeout(timer);
  }, [clock, revertAt]);

  return clock;
}

export type ComposerSelectionOptions = {
  /** Treat the Chat as a draft: its first send names the shown selection, even
   *  where the page has no draft Chat registered to say so. */
  firstSend?: boolean;
};

/**
 * The composer's model and effort selection, and the fields its next send
 * names. One derivation for the picker, the effort control, the attachment
 * capabilities, and every send path.
 */
export function useComposerSelection(
  options: ComposerSelectionOptions = {},
): ComposerSelectionState {
  const { displayedSelection, chatExists, pickedSelector, pickedEffort } =
    useChatContext();

  const modelsQuery = useModelsQuery();

  const data = modelsQuery.data;
  const firstSend = options.firstSend ?? !chatExists;

  const selectionClock = useHoldExpiryClock(displayedSelection?.hold?.revertAt);

  const derived = React.useMemo(
    () =>
      deriveSelection({
        data,
        displayedSelection,
        pickedSelector,
        pickedEffort,
        firstSend,
        now: new Date(selectionClock),
      }),
    [
      data,
      displayedSelection,
      firstSend,
      pickedEffort,
      pickedSelector,
      selectionClock,
    ],
  );

  return {
    data,
    ...derived,
    ...composerReadiness(modelsQuery, data, derived.send.ready),
    roles: data?.roles ?? NO_ROLES,
  };
}
