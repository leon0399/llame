import type { BashUnknownResult } from "./types";

export function completeAttemptUnknown(attemptId: string): BashUnknownResult {
  return {
    status: "error",
    type: "outcome_unknown",
    attemptId,
    message:
      "Command outcome could not be established; inspect the workspace before retrying. The attempt will not be replayed automatically.",
  };
}
