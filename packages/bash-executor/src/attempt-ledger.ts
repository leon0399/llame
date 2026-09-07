import type { BashAttemptReceipt, BashUnknownResult } from "./types";

export type AttemptState = "started" | "known" | "unknown";

export type AttemptRecord = {
  readonly attemptId: string;
  readonly commandDigest: string;
  readonly workingDirectory: string;
  readonly toolCallId: string | null;
  readonly recordedAt: string;
  state: AttemptState;
};

const attempts = new Map<string, AttemptRecord>();
const fencedDirectories = new Set<string>();
/** Digests that ended unknown; never auto-replay under a new tool-call ID. */
const unreplayableDigests = new Set<string>();

export function resetAttemptLedgerForTests(): void {
  attempts.clear();
  fencedDirectories.clear();
  unreplayableDigests.clear();
}

export function recordAttemptStart(
  receipt: BashAttemptReceipt,
  workingDirectory: string,
  toolCallId: string | null = null,
): AttemptRecord {
  const record: AttemptRecord = {
    attemptId: receipt.attemptId,
    commandDigest: receipt.commandDigest,
    workingDirectory,
    toolCallId,
    recordedAt: receipt.recordedAt,
    state: "started",
  };
  attempts.set(record.attemptId, record);
  return record;
}

export function completeAttemptKnown(attemptId: string): void {
  const record = attempts.get(attemptId);
  if (!record || record.state !== "started") return;
  record.state = "known";
}

export function completeAttemptUnknown(attemptId: string): BashUnknownResult {
  const record = attempts.get(attemptId);
  if (record && record.state === "started") {
    record.state = "unknown";
    fencedDirectories.add(record.workingDirectory);
    unreplayableDigests.add(record.commandDigest);
  }
  return {
    status: "error",
    type: "outcome_unknown",
    attemptId,
    message: "Command outcome could not be established; it was not replayed.",
  };
}

/** Host-crash recovery: every incomplete attempt becomes unknown and fences. */
export function recoverIncompleteAttempts(): ReadonlyArray<BashUnknownResult> {
  const results: Array<BashUnknownResult> = [];
  for (const record of attempts.values()) {
    if (record.state !== "started") continue;
    results.push(completeAttemptUnknown(record.attemptId));
  }
  return results;
}

export function isDirectoryFenced(workingDirectory: string): boolean {
  return fencedDirectories.has(workingDirectory);
}

export function clearFence(workingDirectory: string): void {
  fencedDirectories.delete(workingDirectory);
}

/** Operator recovery after proving the workspace is safe. */
export function releaseUnknownCommands(workingDirectory: string): void {
  for (const record of attempts.values()) {
    if (
      record.workingDirectory === workingDirectory &&
      record.state === "unknown"
    ) {
      unreplayableDigests.delete(record.commandDigest);
    }
  }
}

export function getAttempt(attemptId: string): AttemptRecord | undefined {
  return attempts.get(attemptId);
}

/** Unknown command digests are not auto-replayed until the fence is cleared. */
export function refusesUnknownReplay(commandDigest: string): boolean {
  return unreplayableDigests.has(commandDigest);
}
