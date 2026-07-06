/**
 * Pure tool-loop step-budget helpers for the model client's `stopWhen` (#91).
 * Kept in the models layer (the client owns the AI SDK loop) and free of any
 * `ai` import so it's trivially unit-tested.
 */

/** Cumulative total tokens across completed tool-loop steps (missing usage → 0). */
export function sumStepTotalTokens(
  steps: ReadonlyArray<{ usage?: { totalTokens?: number } | null }>,
): number {
  return steps.reduce((sum, s) => sum + (s.usage?.totalTokens ?? 0), 0);
}

/** A `stopWhen` predicate: stop once the run's cumulative tokens reach `cap`. */
export function runTokenCapReached(
  cap: number,
  steps: ReadonlyArray<{ usage?: { totalTokens?: number } | null }>,
): boolean {
  return sumStepTotalTokens(steps) >= cap;
}
