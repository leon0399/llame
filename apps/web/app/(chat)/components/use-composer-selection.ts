"use client";

import * as React from "react";

import { useChatContext } from "@/contexts/chat-context";
import type { ChatFallbackHoldResponse } from "@/lib/api/generated/models";
import {
  type AvailableModel,
  type ModelsResponse,
  useModelsQuery,
} from "@/lib/services/models/queries";
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
};

/** One derivation of the shown selection, its hold, its model, its effort, and
 *  the fields the next send names — shared by every composer surface. */
function deriveSelection(args: DeriveArgs): DerivedSelection {
  const { data, displayedSelection, pickedSelector, pickedEffort, firstSend } =
    args;

  // One instant for the hold's expiry, the model, and the effort: at
  // `revertAt`, two reads could otherwise disagree about which model applies.
  const now = new Date();

  const selection = composerSelection(displayedSelection, data, {
    selector: pickedSelector,
    effort: pickedEffort,
  });

  const hold =
    selection === null ? undefined : applicableHold(selection, data, now);

  const model = resolveDisplayedModel(selection, data, now);

  const effort = resolveDisplayedEffort({
    selection,
    model,
    pickedEffort,
    data,
    now,
  });

  const send = resolveSendSelection({
    selection,
    model,
    firstSend,
    picks: { selector: pickedSelector, effort: pickedEffort },
    shownEffort: effort,
  });

  return {
    selection,
    hold,
    model,
    effort,
    send,
    accepted: acceptedSelectionFor({
      send,
      selection,
      shownEffort: effort,
      data,
      now,
    }),
  };
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

  const derived = React.useMemo(
    () =>
      deriveSelection({
        data,
        displayedSelection,
        pickedSelector,
        pickedEffort,
        firstSend,
      }),
    [data, displayedSelection, firstSend, pickedEffort, pickedSelector],
  );

  const availableModels = data?.models ?? EMPTY_MODELS;

  return {
    data,
    ...derived,
    availableModels,
    modelReadyForSend: modelsQuery.isSuccess && derived.send.ready,
    modelSendUnavailableReason: sendUnavailableReason(
      modelsQuery,
      availableModels,
      derived.send.ready,
    ),
  };
}
