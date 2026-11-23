"use client";

import { useState } from "react";
import { ArrowRightIcon, PlayIcon, RefreshCwIcon } from "lucide-react";

import type { ChatStatus } from "ai";
import { ButtonGroup } from "@workspace/ui/components/button-group";

import { useChatContext } from "@/contexts/chat-context";
import type {
  ChatLatestRunResponse,
  ModelRoleResponse,
} from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";
import {
  namedNextCandidate,
  nextCandidateLabel,
  type NextCandidate,
} from "@/lib/services/models/next-candidate";
import type { AvailableModel } from "@/lib/services/models/queries";

import { MessageActionButton } from "./message-action-button";
import { RegenerateConfirmDialog } from "./regenerate-confirm-dialog";
import { RegenerateMenu } from "./regenerate-menu";
import {
  discardedCallNames,
  turnActionVisibility,
  type TurnActionVisibility,
  type TurnReply,
} from "./turn-action-rules";

type TurnActionsProps = {
  chatId: string;
  /** The Chat's newest Run; null hides both actions. */
  latestRun: ChatLatestRunResponse | null;
  /** The reply these actions judge, or null for a turn that left none. */
  reply: TurnReply | null;
  status: ChatStatus;
  /** The configured roles, which decide whether a failed role Run has a next
   *  candidate. */
  roles: ReadonlyArray<ModelRoleResponse>;
  /** The catalog, for the next candidate's name. */
  availableModels: ReadonlyArray<AvailableModel>;
  onFollowUp: (request: FollowUpRunRequest) => void;
};

type RegenerateSplitButtonProps = {
  chatId: string;
  latestRun: ChatLatestRunResponse;
  requestFollowUp: (request: FollowUpRunRequest) => void;
};

/**
 * The plain Regenerate click: no selector and no effort, so the Chat's stored
 * selection applies, and the accepted permission mode of the latest Run
 * whatever the composer shows (D13, turn-actions "A plain click repeats the old
 * settings").
 */
function repeatRequest(latestRun: ChatLatestRunResponse): FollowUpRunRequest {
  return {
    action: "regenerate",
    permissionMode: latestRun.permissionMode,
  };
}

/** Regenerate and its settings trigger, joined as one split button: the two
 *  ghost cells share a hover block, so the pair reads as one action. */
function RegenerateSplitButton({
  chatId,
  latestRun,
  requestFollowUp,
}: RegenerateSplitButtonProps) {
  return (
    <ButtonGroup>
      <MessageActionButton
        label="Regenerate"
        icon={RefreshCwIcon}
        onClick={() => requestFollowUp(repeatRequest(latestRun))}
      />
      <RegenerateMenu chatId={chatId} requestFollowUp={requestFollowUp} />
    </ButtonGroup>
  );
}

type ContinueButtonProps = {
  chatId: string;
  onFollowUp: (request: FollowUpRunRequest) => void;
};

/** Continue resumes the reply's completed steps; the permission mode is the
 *  composer's, because the Run's own mode is not resumable state (D13). */
function ContinueButton({ chatId, onFollowUp }: ContinueButtonProps) {
  const { getPermissionMode } = useChatContext();

  return (
    <MessageActionButton
      label="Continue"
      icon={PlayIcon}
      onClick={() =>
        onFollowUp({
          action: "continue",
          permissionMode: getPermissionMode(chatId),
        })
      }
    />
  );
}

type NextCandidateButtonProps = {
  chatId: string;
  candidate: NextCandidate;
  availableModels: ReadonlyArray<AvailableModel>;
  onFollowUp: (request: FollowUpRunRequest) => void;
};

/** Continue on the next candidate of a role Run: the label names the model
 *  the new segment starts on and marks a paid one. The permission mode is the
 *  composer's, as for a plain Continue. */
function NextCandidateButton({
  chatId,
  candidate,
  availableModels,
  onFollowUp,
}: NextCandidateButtonProps) {
  const { getPermissionMode } = useChatContext();
  const named = namedNextCandidate(candidate, availableModels);

  return (
    <MessageActionButton
      label={nextCandidateLabel(named)}
      icon={ArrowRightIcon}
      onClick={() =>
        onFollowUp({
          action: "continue",
          candidate: "next",
          permissionMode: getPermissionMode(chatId),
        })
      }
    />
  );
}

type TurnActionRowProps = {
  chatId: string;
  latestRun: ChatLatestRunResponse;
  visibility: TurnActionVisibility;
  availableModels: ReadonlyArray<AvailableModel>;
  onFollowUp: (request: FollowUpRunRequest) => void;
  requestFollowUp: (request: FollowUpRunRequest) => void;
};

/** The row's buttons: Continue when the reply has a step to resume, the next
 *  candidate when a failed role Run has one, and Regenerate always. */
function TurnActionRow({
  chatId,
  latestRun,
  visibility,
  availableModels,
  onFollowUp,
  requestFollowUp,
}: TurnActionRowProps) {
  return (
    <>
      {visibility.continueTurn && (
        <ContinueButton chatId={chatId} onFollowUp={onFollowUp} />
      )}
      {visibility.nextCandidate !== null && (
        <NextCandidateButton
          chatId={chatId}
          candidate={visibility.nextCandidate}
          availableModels={availableModels}
          onFollowUp={onFollowUp}
        />
      )}
      <RegenerateSplitButton
        chatId={chatId}
        latestRun={latestRun}
        requestFollowUp={requestFollowUp}
      />
    </>
  );
}

/** The follow-up a turn's row sends: at once, or after the owner confirms a
 *  Regenerate that would discard calls whose effects stay. */
function useTurnFollowUp(
  reply: TurnReply | null,
  onFollowUp: (request: FollowUpRunRequest) => void,
) {
  const [pending, setPending] = useState<FollowUpRunRequest | null>(null);
  const discarded = reply === null ? [] : discardedCallNames(reply.parts);

  return {
    pending,
    discarded,
    request: (request: FollowUpRunRequest) => {
      if (discarded.length === 0) {
        onFollowUp(request);

        return;
      }

      setPending(request);
    },
    confirm: () => {
      if (pending !== null) onFollowUp(pending);
      setPending(null);
    },
    cancel: () => setPending(null),
  };
}

/**
 * The latest turn's turn-level actions (turn-actions D13). Continue appears
 * only on a reply its own terminal Run left unfinished with a settled tool
 * part to resume from; Regenerate appears whenever that Run is terminal — also
 * on a turn that left no reply at all. Continue on next candidate appears when
 * a failed role Run has a candidate after the model it used (model-roles).
 * None appears while a request is in flight. A Regenerate that would discard a
 * call whose effects stay asks first, naming those calls, and a cancel sends
 * nothing.
 *
 * @summary Continue, Continue on next candidate, and the split Regenerate
 * button for the latest turn
 */
export function TurnActions({
  chatId,
  latestRun,
  reply,
  status,
  roles,
  availableModels,
  onFollowUp,
}: TurnActionsProps) {
  const visibility = turnActionVisibility({ latestRun, reply, status, roles });
  const followUp = useTurnFollowUp(reply, onFollowUp);

  if (visibility === null || latestRun === null) return null;

  return (
    <>
      <TurnActionRow
        chatId={chatId}
        latestRun={latestRun}
        visibility={visibility}
        availableModels={availableModels}
        onFollowUp={onFollowUp}
        requestFollowUp={followUp.request}
      />
      <RegenerateConfirmDialog
        discarded={followUp.discarded}
        open={followUp.pending !== null}
        onConfirm={followUp.confirm}
        onCancel={followUp.cancel}
      />
    </>
  );
}
