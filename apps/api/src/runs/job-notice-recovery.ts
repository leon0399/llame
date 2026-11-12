import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { isString } from '@workspace/runtime-safety';

import { runEvents, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/**
 * Return notice receipts from the discarded segment before this attempt's
 * dispatch. The first query is deliberately limited to the current attempt's
 * start metadata; a boundary attempt has no such event and reads no completion
 * receipts.
 */
export async function discardedJobNoticeIds(input: {
  readonly tx: Db;
  readonly runId: string;
  readonly ownerUserId: string;
  readonly attemptId: string;
}): Promise<Array<string>> {
  const currentStart = await currentAttemptStart(input);

  if (currentStart === undefined) return [];

  const segmentStart = await latestDeliveredSequence(input, currentStart);

  return readConsumedNoticeIds(input, segmentStart, currentStart);
}

async function currentAttemptStart(input: {
  readonly tx: Db;
  readonly runId: string;
  readonly ownerUserId: string;
  readonly attemptId: string;
}): Promise<number | undefined> {
  const [started] = await input.tx
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.runId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'run.started'),
        sql`${runEvents.payload}->>'attemptId' = ${input.attemptId}`,
      ),
    )
    .orderBy(asc(runEvents.sequence))
    .limit(1);

  return started?.sequence;
}

async function latestDeliveredSequence(
  input: {
    readonly tx: Db;
    readonly runId: string;
    readonly ownerUserId: string;
  },
  beforeSequence: number,
): Promise<number> {
  const [delivered] = await input.tx
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.runId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'run.delivered'),
        lt(runEvents.sequence, beforeSequence),
      ),
    )
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  return delivered?.sequence ?? 0;
}

async function readConsumedNoticeIds(
  input: {
    readonly tx: Db;
    readonly runId: string;
    readonly ownerUserId: string;
  },
  segmentStart: number,
  attemptStart: number,
): Promise<Array<string>> {
  const rows = await input.tx
    .select({
      receipts: sql<unknown>`${runEvents.payload}->'consumedJobNoticeIds'`,
    })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.runId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'tool.completed'),
        gt(runEvents.sequence, segmentStart),
        lt(runEvents.sequence, attemptStart),
      ),
    )
    .orderBy(asc(runEvents.sequence));

  return rows.flatMap(({ receipts }) =>
    Array.isArray(receipts) ? receipts.filter(isString) : [],
  );
}
