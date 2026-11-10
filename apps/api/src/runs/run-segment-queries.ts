/**
 * The two reads an attempt makes to prepare its segment (run-steering D3):
 * where the Run's current segment stands, and the Run's own dispatched record
 * as an earlier segment left it. A delivery moves `runs.message_id`, so the
 * message-keyed baseline lookups of `RunsRepository` cannot see the Run's
 * earlier segments any more.
 */

import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { messages, runs, type RunEvent } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  dispatchedRunPredicate,
  RunEventsRepository,
  type CompletedRunWithTrigger,
  type RunEventType,
} from './runs-repository';

/**
 * The Run's latest `run.delivered` (undefined before the first delivery) and
 * the events of `eventTypes` after it, or all of them when none was delivered.
 * A bounded `limit` caps the slice.
 */
export async function eventsSinceLatestDelivery(
  tx: Db,
  runId: string,
  userId: string,
  options: { eventTypes: ReadonlyArray<RunEventType>; limit?: number },
): Promise<{ delivered: RunEvent | undefined; events: Array<RunEvent> }> {
  const repo = new RunEventsRepository(tx);

  const found = await repo.findFirstByType(runId, userId, 'run.delivered', {
    newest: true,
  });

  const delivered = found ?? undefined;

  const events = await repo.listByRunId(runId, userId, {
    ...options,
    ...(delivered !== undefined && { afterSequence: delivered.sequence }),
  });

  return { delivered, events };
}

/**
 * Where the Run's current segment stands: whether a delivery started it, and
 * whether its first request went out, which is a `model.requested` after the
 * latest `run.delivered` (after `run.created` when none). The Run's own
 * availability record cannot say, because the dispatch of a segment overwrites
 * the record of the one before it.
 */
export async function currentSegmentState(
  tx: Db,
  runId: string,
  userId: string,
): Promise<{ delivered: boolean; dispatched: boolean }> {
  const { delivered, events } = await eventsSinceLatestDelivery(
    tx,
    runId,
    userId,
    { eventTypes: ['model.requested'], limit: 1 },
  );

  return { delivered: delivered !== undefined, dispatched: events.length > 0 };
}

/**
 * The sequence of the Run's latest `run.delivered`, or 0 before the first: the
 * cursor from which a resume replays the current segment's stream (D9).
 */
export async function latestDeliverySequence(
  tx: Db,
  runId: string,
  userId: string,
): Promise<number> {
  const delivered = await new RunEventsRepository(tx).findFirstByType(
    runId,
    userId,
    'run.delivered',
    { newest: true },
  );

  return delivered?.sequence ?? 0;
}

/**
 * The Run's own dispatched record, read through the newest reply before
 * `beforeSeq` whose usage names the Run, with the sequence of the user message
 * that reply answers. Undefined when the Run has no such reply or never
 * dispatched.
 */
export async function findEarlierSegmentBaseline(
  tx: Db,
  input: { chatId: string; userId: string; runId: string; beforeSeq: number },
): Promise<CompletedRunWithTrigger | undefined> {
  const trigger = alias(messages, 'trigger');

  const [row] = await tx
    .select({ run: runs, triggeringUserSeq: trigger.seq })
    .from(messages)
    .innerJoin(
      trigger,
      and(
        eq(trigger.id, messages.inReplyTo),
        eq(trigger.chatId, messages.chatId),
      ),
    )
    .innerJoin(
      runs,
      and(eq(runs.id, input.runId), eq(runs.chatId, messages.chatId)),
    )
    .where(
      and(
        eq(messages.chatId, input.chatId),
        eq(messages.role, 'assistant'),
        lt(messages.seq, input.beforeSeq),
        sql`(${messages.usage} ->> 'runId') = ${input.runId}`,
        eq(runs.userId, input.userId),
        dispatchedRunPredicate(),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(1);

  return row;
}
