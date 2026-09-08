import type { BashUnknownResult, BashUnavailableResult } from "./types";
import { processGroupAlive, signalProcessGroup } from "./process-tree";

const quarantinedGroups = new Map<number, string>();

export function resetAttemptLedgerForTests(): void {
  quarantinedGroups.clear();
}
export function completeAttemptUnknown(
  attemptId: string,
  pgid?: number,
): BashUnknownResult {
  if (pgid !== undefined && processGroupAlive(pgid))
    quarantinedGroups.set(pgid, attemptId);
  return {
    status: "error",
    type: "outcome_unknown",
    attemptId,
    message: "Command outcome could not be established; it was not replayed.",
  };
}

export function rejectQuarantinedGroups(): BashUnavailableResult | null {
  let survivingAttempt: string | undefined;
  for (const [pgid, attemptId] of quarantinedGroups) {
    if (!processGroupAlive(pgid)) {
      quarantinedGroups.delete(pgid);
      continue;
    }
    signalProcessGroup(pgid, "SIGKILL");
    survivingAttempt = attemptId;
  }
  return survivingAttempt === undefined
    ? null
    : {
        status: "error",
        type: "unavailable",
        message: `Process group from attempt ${survivingAttempt} is still alive.`,
      };
}
