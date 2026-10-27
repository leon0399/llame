"use client";

import { useState } from "react";
import { PlayIcon, RefreshCwIcon } from "lucide-react";

import type { ChatStatus } from "ai";
import { ButtonGroup } from "@workspace/ui/components/button-group";

import { useChatContext } from "@/contexts/chat-context";
import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";

import { MessageActionButton } from "./message-action-button";
import { RegenerateConfirmDialog } from "./regenerate-confirm-dialog";
import { RegenerateMenu } from "./regenerate-menu";
import {
  discardedCallNames,
  turnActionVisibility,
  type TurnReply,
} from "./turn-action-rules";

type TurnActionsProps = {
  chatId: string;
  /** The Chat's newest Run; null hides both actions. */
  latestRun: ChatLatestRunResponse | null;
  /** The reply these actions judge, or null for a turn that left none. */
  reply: TurnReply | null;
  status: ChatStatus;
  onFollowUp: (request: FollowUpRunRequest) => void;
};

type RegenerateSplitButtonProps = {
  chatId: string;
  latestRun: ChatLatestRunResponse;
  requestFollowUp: (request: FollowUpRunRequest) => void;
};

/** The plain Regenerate click: a repeat of the latest Run's own model, effort,
 *  and accepted permission mode, whatever the composer shows (D13). The
 *  transport drops the fields the wire body does not take. */
function repeatRequest(latestRun: ChatLatestRunResponse): FollowUpRunRequest {
  return {
    action: "regenerate",
    modelId: latestRun.modelId,
    effort: latestRun.effort ?? undefined,
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

/**
 * The latest turn's turn-level actions (turn-actions D13). Continue appears
 * only on a reply its own terminal Run left unfinished with a settled tool
 * part to resume from; Regenerate appears whenever that Run is terminal — also
 * on a turn that left no reply at all. Neither appears while a request is in
 * flight. A Regenerate that would discard a call whose effects stay asks
 * first, naming those calls, and a cancel sends nothing.
 *
 * @summary Continue and the split Regenerate button for the latest turn
 */
export function TurnActions({
  chatId,
  latestRun,
  reply,
  status,
  onFollowUp,
}: TurnActionsProps) {
  const [pending, setPending] = useState<FollowUpRunRequest | null>(null);
  const visibility = turnActionVisibility({ latestRun, reply, status });

  if (visibility === null || latestRun === null) return null;
  const discarded = reply === null ? [] : discardedCallNames(reply.parts);

  const requestFollowUp = (request: FollowUpRunRequest) => {
    if (discarded.length > 0) {
      setPending(request);
      return;
    }
    onFollowUp(request);
  };

  return (
    <>
      {visibility.continueTurn && (
        <ContinueButton chatId={chatId} onFollowUp={onFollowUp} />
      )}
      <RegenerateSplitButton
        chatId={chatId}
        latestRun={latestRun}
        requestFollowUp={requestFollowUp}
      />
      <RegenerateConfirmDialog
        discarded={discarded}
        open={pending !== null}
        onConfirm={() => {
          if (pending !== null) onFollowUp(pending);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
