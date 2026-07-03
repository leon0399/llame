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
  return { toast: status === "completed" ? "completed" : "failed", badge: true };
}
