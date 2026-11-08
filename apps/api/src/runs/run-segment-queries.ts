/**
 * The two reads an attempt makes to prepare its segment (run-steering D3):
 * where the Run's current segment stands, and the Run's own dispatched record
 * as an earlier segment left it. A delivery moves `runs.message_id`, so the
 * message-keyed baseline lookups of `RunsRepository` cannot see the Run's
 * earlier segments any more.
 */

import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { chats, messages, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  dispatchedRunPredicate,
  RunEventsRepository,
  type CompletedRunWithTrigger,
} from './runs-repository';

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
  const log = await new RunEventsRepository(tx).listByRunId(runId, userId, {
    eventTypes: ['run.delivered', 'model.requested'],
  });
  const delivered = log.findLastIndex(
    ({ eventType }) => eventType === 'run.delivered',
  );
  return {
    delivered: delivered !== -1,
    dispatched: log
      .slice(delivered + 1)
      .some(({ eventType }) => eventType === 'model.requested'),
  };
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
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .innerJoin(
      trigger,
      and(
        eq(trigger.id, messages.inReplyTo),
        eq(trigger.chatId, messages.chatId),
      ),
    )
    .innerJoin(runs, eq(runs.id, input.runId))
    .where(
      and(
        eq(messages.chatId, input.chatId),
        eq(chats.ownerUserId, input.userId),
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
