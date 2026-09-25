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
 * - A failed or finished send clears a hold that never learned the id; when
 *   the id is already known it still cancels.
 */
export function usePendingStop({
  messages,
  stop,
  status,
  deps = defaultDeps,
}: UsePendingStopArgs) {
  const [held, setHeld] = useState(false);

  const runId = runIdToCancel(messages);

  // Prefer cancel when the id is known — a batched start+error render must not
  // drop a held Stop and leave the durable Run running (design M2).
  if (held && runId !== null) {
    setHeld(false);
    // Schedule off the render path — stop() updates chat transport state.
    queueMicrotask(() => {
      cancelAndStop(runId, stop, deps);
    });
  } else if ((status === "ready" || status === "error") && held) {
    // No id ever arrived: clear the hold so a later send does not inherit it.
    setHeld(false);
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
