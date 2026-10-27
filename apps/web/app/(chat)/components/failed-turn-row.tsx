"use client";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";

import { TurnActions } from "./turn-actions";

type FailedTurnRowProps = {
  chatId: string;
  latestRun: ChatLatestRunResponse;
  onRegenerate: (request: FollowUpRunRequest) => void;
};

/**
 * The minimal row a latest turn gets when its Run ended without leaving a
 * reply — a Run that failed at pickup, or one cancelled before its first
 * request (turn-actions D13). There is no answer row to carry the action, so
 * this row carries Regenerate and says only that the turn ended.
 *
 * @summary the latest turn's Regenerate when it has no reply
 */
export function FailedTurnRow({
  chatId,
  latestRun,
  onRegenerate,
}: FailedTurnRowProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 md:px-6">
      <span className="text-muted-foreground text-sm">
        This turn ended without an answer.
      </span>
      <TurnActions
        chatId={chatId}
        latestRun={latestRun}
        reply={null}
        onRegenerate={onRegenerate}
      />
    </div>
  );
}
