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
 * - Id known: fire-and-forget `cancelRun`, then `stop()`.
 * - Id unknown: hold until the placeholder appears, then cancel + stop.
 * - Failed or finished send clears the hold without cancelling.
 */
export function usePendingStop({
  messages,
  stop,
  status,
  deps = defaultDeps,
}: UsePendingStopArgs) {
  const [held, setHeld] = useState(false);

  // Design M2: when the request fails or finishes, clear the hold so a later
  // send does not inherit it and auto-cancel the next Run.
  if ((status === "ready" || status === "error") && held) {
    setHeld(false);
  }

  const runId = runIdToCancel(messages);
  if (held && runId !== null) {
    setHeld(false);
    cancelAndStop(runId, stop, deps);
  }

  const pendingStop = held;

  function requestStop() {
    const knownId = runIdToCancel(messages);
    if (knownId) {
      cancelAndStop(knownId, stop, deps);
      return;
    }
    setHeld(true);
  }

  function clearPendingStop() {
    setHeld(false);
  }

  return { pendingStop, requestStop, clearPendingStop };
}

/** Fire-and-forget cancel, then abort the client stream (design M2). */
function cancelAndStop(
  runId: string,
  stop: () => void | Promise<void>,
  deps: PendingStopDeps,
): void {
  void deps.cancelRun(runId).catch((error: unknown) => {
    console.error("Failed to cancel run", error);
    deps.toastError(
      "Couldn't confirm the response was stopped — it may still be finishing.",
    );
  });
  void stop();
}
