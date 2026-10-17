import type { UIMessage } from "ai";

/**
 * Pure decision logic for run tracking, stream completion, and background
 * run-completion notifications — extracted from the effect so the branching
 * (the regression-prone part) is testable without timers, polling, or the DOM.
 */

export type RunStatus = string;

// A run past this point won't change again (mirrors the api's TERMINAL_STATUSES).
const TERMINAL: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

/** The outcome to surface as a toast and an unseen badge (null = stay silent). */
export type TerminalResolution = "completed" | "failed" | null;

/**
 * Decide how a tracked run reaching a terminal status is surfaced.
 * - `cancelled` → SILENT: the user hit stop, or the run was superseded
 *   (regenerate) — never a surprise toast for something they caused.
 * - visible on that chat → SILENT: they watched the reply arrive.
 * - `completed` → "reply ready"; `failed`/`expired` → a "failed" toast.
 *   `expired` is NOT benign (a reaped/hung/crashed run — the reply never
 *   came), so it's surfaced, not swallowed like a cancel.
 */
export function resolveTerminalRun(
  status: RunStatus,
  opts: { viewingThisChat: boolean; tabHidden: boolean },
): TerminalResolution {
  if (status === "cancelled") {
    return null;
  }
  const alreadySeen = opts.viewingThisChat && !opts.tabHidden;
  if (alreadySeen) {
    return null;
  }
  return status === "completed" ? "completed" : "failed";
}

/**
 * The run id to register for background tracking while a message streams —
 * the last message's id IS the run id (the run-stream-bridge's start-chunk
 * surrogate) once it's the assistant's turn. Null before the first chunk
 * arrives (the last message is still the user's turn) — nothing to track yet.
 *
 * Deliberately local to this notification-tracking concern rather than shared
 * with any similarly-shaped cancel-path helper elsewhere in the chat UI — same
 * derivation, different purpose, no cross-feature import.
 */
export function streamingRunId(
  messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>,
): string | null {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last.id : null;
}

/**
 * A short label for the completion toast/notification: the first user turn's
 * text, truncated, so "Reply ready — <question>" is meaningful. Falls back to
 * a generic label for a turn with no text part (e.g. attachment-only).
 */
export function notificationLabel(
  messages: ReadonlyArray<Pick<UIMessage, "role" | "parts">>,
): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) {
    for (const part of firstUser.parts) {
      if (part.type === "text" && part.text.trim()) {
        const trimmed = part.text.trim();
        return trimmed.length > 48 ? trimmed.slice(0, 48) + "..." : trimmed;
      }
    }
  }
  return "your conversation";
}

/** The completion report `useChat`'s `onFinish` hands the engine. */
export type StreamCompletion = {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  finishReason?: string | undefined;
  messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>;
};

/**
 * Whether a finished stream ended while its Run was still executing: the
 * bridge is the only writer, its terminal chunk is the only signal that the Run
 * reached an end, and a failed Run replaces that chunk with an error. A
 * transport failure, a proxy or deploy cutting the connection, or a stream that
 * simply stops arriving therefore leaves the Run executing server-side (#50),
 * and the client re-attaches instead of reporting a turn that never completed
 * (#1284).
 *
 * The user's own stop is deliberate, and anything else reported as an error is
 * the Run's own terminal failure (or an HTTP refusal) — neither is repaired.
 */
export function isInterruptedStream(
  status: Pick<
    StreamCompletion,
    "isAbort" | "isDisconnect" | "isError" | "finishReason"
  >,
): boolean {
  if (status.isAbort) return false;
  // A dropped fetch surfaces as both `isDisconnect` and `isError`; the
  // connection broke, the Run did not.
  if (status.isDisconnect) return true;
  return !status.isError && status.finishReason === undefined;
}
