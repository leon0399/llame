"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { toast } from "@workspace/ui/components/sonner";

import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import { nextCandidateRun } from "@/lib/services/chat/runs";
import { modelQueryKeys } from "@/lib/services/models/queries";
import { isWaitingTurnRun } from "@/lib/services/models/next-candidate";

export type RunNextCandidateSwitch = {
  /** True while the action is in flight. */
  pending: boolean;
  /** Moves a waiting Run onto its next candidate, then re-reads history. */
  request: () => void;
};

/**
 * The quota-wait box's Continue on next candidate (model-roles "The web
 * offers the next candidate", "A role Run in a quota wait offers the next
 * candidate"). The move happens server-side, so the page only re-reads the
 * Chat: the Run's segment and `latestRun` both change under it.
 */
export function useNextCandidateSwitch(
  latestRun: ChatLatestRunResponse | null,
  refreshChatMessages: () => void,
): RunNextCandidateSwitch {
  const runId = isWaitingTurnRun(latestRun) ? latestRun.id : null;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const request = useCallback(() => {
    if (runId === null || pending) return;

    setPending(true);
    void nextCandidateRun(runId)
      .then((switched) => {
        if (switched) return;

        void queryClient.invalidateQueries({ queryKey: modelQueryKeys.all });
        toast.error("The model switch didn't happen. Try again.");
      })
      .catch(() =>
        toast.error("Couldn't continue on the next candidate. Try again."),
      )
      .finally(() => {
        setPending(false);
        // The Run starts a new segment on the new model: re-read so the
        // transcript follows it, and a refused action drops a stale box.
        refreshChatMessages();
      });
  }, [runId, pending, queryClient, refreshChatMessages]);

  return { pending, request };
}
