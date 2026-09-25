"use client";

import { useState } from "react";
import type { UIMessage } from "ai";

import {
  cancelRun as defaultCancelRun,
  runIdToCancel,
} from "@/lib/services/chat/runs";
import { toast } from "@workspace/ui/components/sonner";

type ChatTransportStatus = "submitted" | "streaming" | "ready" | "error";

type PendingStopDeps = {
  cancelRun: (runId: string) => Promise<void>;
  toastError: (message: string) => void;
};

const defaultDeps: PendingStopDeps = {
  cancelRun: defaultCancelRun,
  toastError: (message) => {
    toast.error(message);
  },
};

type UsePendingStopArgs = {
  messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>;
  stop: () => void | Promise<void>;
  /** Chat transport status — a finished or failed send clears a held Stop. */
  status: ChatTransportStatus;
  deps?: PendingStopDeps;
};

/**
 * Stop that cancels the durable Run once its id is known (design M2).
 *
 * - Id known (placeholder assistant row present): `cancelRun` then `stop()`.
 * - Id unknown (request in flight): set pending, keep the request open; when
 *   the placeholder appears, cancel + stop. A failed/finished send clears the
 *   hold without cancelling.
 *
 * `cancelRun` failures keep today's handling: 404/409 silent; anything else
 * still stops and shows the existing toast.
 */
export function usePendingStop({
  messages,
  stop,
  status,
  deps = defaultDeps,
}: UsePendingStopArgs) {
  const [held, setHeld] = useState(false);
  // A finished or failed send drops the hold without a cancel request.
  const pendingStop = held && status !== "ready" && status !== "error";

  const runId = runIdToCancel(messages);
  const [seenRunId, setSeenRunId] = useState<string | null>(null);
  if (held && runId !== null && runId !== seenRunId) {
    setSeenRunId(runId);
    setHeld(false);
    queueMicrotask(() => {
      void cancelAndStop(runId, stop, deps);
    });
  }

  function requestStop() {
    const knownId = runIdToCancel(messages);
    if (knownId) {
      void cancelAndStop(knownId, stop, deps);
      return;
    }
    setHeld(true);
  }

  function clearPendingStop() {
    setHeld(false);
  }

  return { pendingStop, requestStop, clearPendingStop };
}

async function cancelAndStop(
  runId: string,
  stop: () => void | Promise<void>,
  deps: PendingStopDeps,
): Promise<void> {
  try {
    await deps.cancelRun(runId);
  } catch (error: unknown) {
    console.error("Failed to cancel run", error);
    deps.toastError(
      "Couldn't confirm the response was stopped — it may still be finishing.",
    );
  }
  await stop();
}
