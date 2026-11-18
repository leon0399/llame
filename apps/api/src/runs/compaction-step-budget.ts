import { z } from 'zod';

const deliveryCauseSchema = z.object({ cause: z.string() });

const compactionDeliverySchema = z.object({
  cause: z.literal('compaction'),
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

  const cause = deliveryCauseSchema.safeParse(delivery.payload);

  if (!cause.success) return Number.MAX_SAFE_INTEGER;

  if (cause.data.cause !== 'compaction') return 0;

  const parsed = compactionDeliverySchema.safeParse(delivery.payload);

  return parsed.success ? parsed.data.stepBudgetUsed : Number.MAX_SAFE_INTEGER;
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
