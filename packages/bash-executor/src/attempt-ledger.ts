import type { BashUnknownResult, BashUnavailableResult } from "./types";
import { processGroupAlive, signalProcessGroup } from "./process-tree";

const QUARANTINE_SWEEP_INTERVAL_MS = 100;

const quarantinedGroups = new Map<number, string>();
let quarantineSweepTimer: NodeJS.Timeout | undefined;

export function resetAttemptLedgerForTests(): void {
  if (quarantineSweepTimer !== undefined) {
    clearInterval(quarantineSweepTimer);
    quarantineSweepTimer = undefined;
  }
  quarantinedGroups.clear();
}

export function completeAttemptUnknown(
  attemptId: string,
  pgid?: number,
): BashUnknownResult {
  if (pgid !== undefined && processGroupAlive(pgid)) {
    quarantinedGroups.set(pgid, attemptId);
    armQuarantineSweep();
  }
  return {
    status: "error",
    type: "outcome_unknown",
    attemptId,
    message: "Command outcome could not be established; it was not replayed.",
  };
}

export function rejectQuarantinedGroups(): BashUnavailableResult | null {
  sweepQuarantinedGroups();
  let survivingAttempt: string | undefined;
  for (const [pgid, attemptId] of quarantinedGroups) {
    signalProcessGroup(pgid, "SIGKILL");
    survivingAttempt = attemptId;
  }
  if (quarantinedGroups.size === 0) disarmQuarantineSweep();
  return survivingAttempt === undefined
    ? null
    : {
        status: "error",
        type: "unavailable",
        message: `Process group from attempt ${survivingAttempt} is still alive.`,
      };
}

function armQuarantineSweep(): void {
  if (quarantineSweepTimer !== undefined) return;
  quarantineSweepTimer = setInterval(
    sweepQuarantinedGroups,
    QUARANTINE_SWEEP_INTERVAL_MS,
  );
  quarantineSweepTimer.unref();
}

function disarmQuarantineSweep(): void {
  if (quarantineSweepTimer === undefined) return;
  clearInterval(quarantineSweepTimer);
  quarantineSweepTimer = undefined;
}

function sweepQuarantinedGroups(): void {
  for (const [pgid] of quarantinedGroups) {
    if (!processGroupAlive(pgid)) quarantinedGroups.delete(pgid);
  }
  if (quarantinedGroups.size === 0) disarmQuarantineSweep();
}
