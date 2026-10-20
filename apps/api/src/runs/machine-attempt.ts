/**
 * Per-attempt Machine identity (remote-machines D3/D5). Reachability is decided
 * once per attempt, and every preparation-time Machine call carries the same
 * relative budget and durable identity a tool call does, so the connector's
 * verdict cache and the daemon's fence see one attempt, not one caller.
 */

import { type RequestEnvelope } from '@workspace/machine-protocol';

/**
 * The budget a preparation-time Machine call carries when the caller names
 * none. Tool calls carry their own per-call deadline; a preparation, an
 * instruction probe, and a skill snapshot have no model-facing deadline of
 * their own, so they share one generous bound instead of none.
 */
export const MACHINE_PREPARATION_BUDGET_MS = 30_000;

/**
 * The connector's per-attempt reachability key. A Run's delivery sequence is
 * per-Run, so the Run id is part of the key: two Runs dispatching to one worker
 * must not share a verdict.
 */
export function machineAttemptKey(
  runId: string,
  deliverySequence: number | undefined,
): string {
  return `${runId}\u0000${deliverySequence ?? 'none'}`;
}

/** The envelope of one Machine request; absent identities stay absent. */
export function machineEnvelope(input: {
  readonly runId?: string;
  readonly attemptId?: string;
  readonly toolCallId?: string;
  readonly deliverySequence?: number;
  readonly budgetMs?: number;
}): RequestEnvelope {
  return {
    ...(input.runId !== undefined && { runId: input.runId }),
    ...(input.attemptId !== undefined && { attemptId: input.attemptId }),
    ...(input.toolCallId !== undefined && { toolCallId: input.toolCallId }),
    ...(input.deliverySequence !== undefined && {
      deliverySeq: input.deliverySequence,
    }),
    budgetMs: input.budgetMs ?? MACHINE_PREPARATION_BUDGET_MS,
  };
}
