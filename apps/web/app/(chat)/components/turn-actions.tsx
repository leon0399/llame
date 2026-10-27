"use client";

import { useState } from "react";
import { PlayIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";

import { useChatContext } from "@/contexts/chat-context";
import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";

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
  onRegenerate: (request: FollowUpRunRequest) => void;
};

type RegenerateSplitButtonProps = {
  chatId: string;
  latestRun: ChatLatestRunResponse;
  requestRegenerate: (request: FollowUpRunRequest) => void;
};

/** The plain Regenerate click: a repeat of the latest Run's own model, effort,
 *  and accepted permission mode, whatever the composer shows (D13). */
function repeatRequest(latestRun: ChatLatestRunResponse): FollowUpRunRequest {
  return {
    action: "regenerate",
    modelId: latestRun.modelId,
    ...(latestRun.effort !== null && { effort: latestRun.effort }),
    ...(latestRun.permissionMode === "bypass" && {
      permissionMode: latestRun.permissionMode,
    }),
  };
}

/** Regenerate and its menu trigger, side by side as one split button. */
function RegenerateSplitButton({
  chatId,
  latestRun,
  requestRegenerate,
}: RegenerateSplitButtonProps) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => requestRegenerate(repeatRequest(latestRun))}
      >
        <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
        <span className="text-trim-cap">Regenerate</span>
      </Button>
      <RegenerateMenu chatId={chatId} requestRegenerate={requestRegenerate} />
    </>
  );
}

type ContinueButtonProps = {
  chatId: string;
  onRegenerate: (request: FollowUpRunRequest) => void;
};

/** Continue resumes the reply's completed steps; the permission mode is the
 *  composer's, because the Run's own mode is not resumable state (D13). */
function ContinueButton({ chatId, onRegenerate }: ContinueButtonProps) {
  const { getPermissionMode } = useChatContext();
  const permissionMode = getPermissionMode(chatId);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() =>
        onRegenerate({
          action: "continue",
          ...(permissionMode === "bypass" && { permissionMode }),
        })
      }
    >
      <PlayIcon data-icon="inline-start" aria-hidden="true" />
      <span className="text-trim-cap">Continue</span>
    </Button>
  );
}

/**
 * The latest turn's turn-level actions (turn-actions D13). Continue appears
 * only on a reply its own terminal Run left unfinished with a settled tool
 * part to resume from; Regenerate appears whenever that Run is terminal — also
 * on a turn that left no reply at all. A Regenerate that would discard a call
 * whose effects stay asks first, naming those calls, and a cancel sends
 * nothing.
 *
 * @summary Continue and the split Regenerate button for the latest turn
 */
export function TurnActions({
  chatId,
  latestRun,
  reply,
  onRegenerate,
}: TurnActionsProps) {
  const [pending, setPending] = useState<FollowUpRunRequest | null>(null);
  const visibility = turnActionVisibility({ latestRun, reply });
  const discarded = reply === null ? [] : discardedCallNames(reply.parts);

  if (latestRun === null) return null;
  if (!visibility.continueTurn && !visibility.regenerate) return null;

  const requestRegenerate = (request: FollowUpRunRequest) => {
    if (discarded.length > 0) {
      setPending(request);
      return;
    }
    onRegenerate(request);
  };

  return (
    <>
      <TurnActionButtons
        chatId={chatId}
        latestRun={latestRun}
        visibility={visibility}
        onContinue={onRegenerate}
        requestRegenerate={requestRegenerate}
      />
      <RegenerateConfirmDialog
        discarded={discarded}
        open={pending !== null}
        onConfirm={() => {
          if (pending !== null) onRegenerate(pending);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

type TurnActionButtonsProps = {
  chatId: string;
  latestRun: ChatLatestRunResponse;
  visibility: TurnActionVisibility;
  onContinue: (request: FollowUpRunRequest) => void;
  requestRegenerate: (request: FollowUpRunRequest) => void;
};

/** The visible controls: Continue (when offered) beside the Regenerate split
 *  button. Split out of `TurnActions` to keep both within the line budget. */
function TurnActionButtons({
  chatId,
  latestRun,
  visibility,
  onContinue,
  requestRegenerate,
}: TurnActionButtonsProps) {
  return (
    <>
      {visibility.continueTurn && (
        <ContinueButton chatId={chatId} onRegenerate={onContinue} />
      )}
      {visibility.regenerate && (
        <RegenerateSplitButton
          chatId={chatId}
          latestRun={latestRun}
          requestRegenerate={requestRegenerate}
        />
      )}
    </>
  );
}
