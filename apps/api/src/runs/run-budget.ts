import type { FinishReason, LanguageModelUsage } from 'ai';

import { snapshotMaxOutputTokens } from '../config-resolver/effective-config';

/**
 * Per-run budget (#91, SPEC §29): the caps a run executes under, read from
 * the run's effective-config snapshot (runs.config_snapshot, #46). v0.2 runs
 * are a single model call, so the only cap with teeth is output tokens; step
 * and cost caps join when the tool loop and cost accounting give them
 * something to bite on.
 */
export type RunBudget = {
  maxOutputTokens?: number;
};

/** runs.config_snapshot → the budget this run executes under (null = none). */
export function readRunBudget(configSnapshot: unknown): RunBudget | null {
  const maxOutputTokens = snapshotMaxOutputTokens(configSnapshot);
  return maxOutputTokens !== undefined ? { maxOutputTokens } : null;
}

/**
 * Did this finished stream breach the budget? Primary signal is the provider's
 * finishReason 'length' (it enforced the cap). The usage fallback covers
 * providers that stop at the cap but report an unhelpful finish reason — it
 * deliberately does NOT fire on a clean 'stop' finish, where output happening
 * to land exactly on the cap is completion, not a breach.
 */
export function isBudgetExceeded(
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
