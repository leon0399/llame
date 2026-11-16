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

  const parsed = compactionDeliverySchema.safeParse(delivery?.payload);

  return parsed.success && parsed.data.cause === 'compaction'
    ? parsed.data.stepBudgetUsed
    : 0;
}
