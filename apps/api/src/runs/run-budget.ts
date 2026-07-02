import type { ConfigService } from '@nestjs/config';
import type { FinishReason, LanguageModelUsage } from 'ai';

/**
 * Per-run budget (#91, SPEC §29): the caps a run executes under, snapshotted
 * onto the run row at creation (runs.budget). v0.2 runs are a single model
 * call, so the only cap with teeth is output tokens; step and cost caps join
 * when the tool loop (v0.7) and cost accounting (v0.4, #37) give them
 * something to bite on. The jsonb column is shape-compatible with both.
 */
export type RunBudget = {
  maxOutputTokens?: number;
};

/**
 * Resolve the effective run budget from config. Env-scoped for v0.2
 * (`RUN_MAX_OUTPUT_TOKENS`); the per-user/group/project config resolver (#46)
 * replaces this lookup without changing the snapshot-at-creation contract.
 * Returns null (no budget) when unset or invalid — budgets are opt-in.
 */
export function resolveRunBudget(config: ConfigService): RunBudget | null {
  const raw = Number(config.get<string>('RUN_MAX_OUTPUT_TOKENS'));
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return { maxOutputTokens: Math.floor(raw) };
}

/** Narrow an untyped runs.budget jsonb value back into a RunBudget. */
export function readRunBudget(value: unknown): RunBudget | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const cap = (value as { maxOutputTokens?: unknown }).maxOutputTokens;
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) {
    return null;
  }
  return { maxOutputTokens: Math.floor(cap) };
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
