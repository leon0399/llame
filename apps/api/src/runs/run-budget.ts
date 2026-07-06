import type { FinishReason, LanguageModelUsage } from 'ai';

import {
  snapshotMaxOutputTokens,
  snapshotMaxRunTokens,
} from '../config-resolver/effective-config';

/**
 * Per-run budget (#91, SPEC §29): the caps a run executes under, read from
 * the run's effective-config snapshot (runs.config_snapshot, #46).
 * - `maxOutputTokens` — per-CALL output cap (the provider enforces it).
 * - `maxRunTokens` — CUMULATIVE total-token cap across the tool loop's steps.
 *   Each step re-sends the growing context, so `maxSteps × maxOutputTokens`
 *   under-counts real spend; this bounds the run's actual token cost. Opt-in
 *   (unset = no cap) — no default that could truncate a legit long run.
 */
export type RunBudget = {
  maxOutputTokens?: number;
  maxRunTokens?: number;
};

/** runs.config_snapshot → the budget this run executes under (null = none). */
export function readRunBudget(configSnapshot: unknown): RunBudget | null {
  const maxOutputTokens = snapshotMaxOutputTokens(configSnapshot);
  const maxRunTokens = snapshotMaxRunTokens(configSnapshot);
  if (maxOutputTokens === undefined && maxRunTokens === undefined) {
    return null;
  }
  return {
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(maxRunTokens !== undefined ? { maxRunTokens } : {}),
  };
}

/**
 * Cumulative run-token cap (#91) breach: the tool loop was CUT at/over the cap.
 * A natural 'stop' finish exactly at the cap is completion, not a breach (mirrors
 * the per-call nuance below); a cap-cut loop reports a non-'stop' finishReason.
 * Exported so the run's failure surfacing can distinguish which cap fired.
 */
export function isRunTokenBudgetExceeded(
  budget: RunBudget | null | undefined,
  outcome: { finishReason: FinishReason | null; totalTokens?: number | null },
): boolean {
  const runCap = budget?.maxRunTokens;
  return (
    runCap !== undefined &&
    typeof outcome.totalTokens === 'number' &&
    outcome.totalTokens >= runCap &&
    outcome.finishReason !== 'stop'
  );
}

/**
 * Per-call output-token cap breach (the provider enforced the ceiling).
 * Primary signal is the provider's finishReason 'length'. The usage fallback
 * covers providers that stop at the cap but report an unhelpful finish
 * reason — it deliberately does NOT fire on a clean 'stop' finish, where
 * output happening to land exactly on the cap is completion, not a breach.
 */
function isOutputBudgetExceeded(
  budget: RunBudget | null | undefined,
  outcome: {
    finishReason: FinishReason | null;
    usage?: Partial<LanguageModelUsage> | null;
  },
): boolean {
  const cap = budget?.maxOutputTokens;
  if (cap === undefined) {
    return false;
  }
  if (outcome.finishReason === 'length') {
    return true;
  }
  const vague =
    outcome.finishReason === null || outcome.finishReason === 'other';
  const outputTokens = outcome.usage?.outputTokens;
  return vague && typeof outputTokens === 'number' && outputTokens >= cap;
}

/** Did this finished stream breach EITHER cap? */
export function isBudgetExceeded(
  budget: RunBudget | null | undefined,
  outcome: {
    finishReason: FinishReason | null;
    usage?: Partial<LanguageModelUsage> | null;
    totalTokens?: number | null;
  },
): boolean {
  return (
    isRunTokenBudgetExceeded(budget, outcome) ||
    isOutputBudgetExceeded(budget, outcome)
  );
}
