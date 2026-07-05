import type { UIMessage } from "ai";

/**
 * Pure decision logic for background run-completion notifications — extracted
 * from the effect so the branching (the regression-prone part) is testable
 * without timers, polling, or the DOM.
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

export type TerminalResolution = {
  /** Which toast to show (null = stay silent). */
  toast: "completed" | "failed" | null;
  /** Whether to mark the chat with an unseen-completion badge. */
  badge: boolean;
};

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
    return { toast: null, badge: false };
  }
  const alreadySeen = opts.viewingThisChat && !opts.tabHidden;
  if (alreadySeen) {
    return { toast: null, badge: false };
  }
  return {
    toast: status === "completed" ? "completed" : "failed",
    badge: true,
  };
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
  for (const part of firstUser?.parts ?? []) {
    if (part.type === "text" && part.text.trim()) {
      return part.text.slice(0, 48);
    }
  }
  return "your conversation";
}
