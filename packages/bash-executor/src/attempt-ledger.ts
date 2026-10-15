import type { BashUnknownResult } from "./types";

/** Test hook retained so suites can reset module state beside process counters. */
export function resetAttemptLedgerForTests(): void {
  // Quarantine state was removed; kept for call-site stability in tests.
}

export function completeAttemptUnknown(attemptId: string): BashUnknownResult {
  return {
    status: "error",
    type: "outcome_unknown",
    attemptId,
    message:
      "Command outcome could not be established; inspect the workspace before retrying. The attempt will not be replayed automatically.",
  };
}
