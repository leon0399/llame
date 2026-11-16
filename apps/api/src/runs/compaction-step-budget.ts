import { z } from 'zod';

const compactionDeliverySchema = z.object({
  cause: z.string(),
  stepBudgetUsed: z.number().int().nonnegative(),
});

/** Read a persisted compaction delivery budget; malformed JSON fails closed. */
export function readCompactionStepBudget(
  events: ReadonlyArray<{ eventType: string; payload: unknown }>,
): number {
  const delivery = events.findLast(
    (event) => event.eventType === 'run.delivered',
  );

  if (delivery === undefined) return 0;

  const parsed = compactionDeliverySchema.safeParse(delivery.payload);

  return parsed.success && parsed.data.cause === 'compaction'
    ? parsed.data.stepBudgetUsed
    : parsed.success
      ? 0
      : Number.MAX_SAFE_INTEGER;
}

export function boundaryStepBudgetUsed(input: {
  stepBudgetOffset: number;
  stepBase: number;
  stepsStarted: number;
  wakeStepOffset: number;
}): number {
  return (
    input.stepBudgetOffset +
    input.stepBase +
    input.stepsStarted +
    input.wakeStepOffset
  );
}
