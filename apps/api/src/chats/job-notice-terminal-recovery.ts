import { and, desc, eq, sql } from 'drizzle-orm';

import { chatDeliveries, runEvents, runs, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';

/** Return a boundary notice only when its receiving segment never dispatched. */
export async function returnUndispatchedJobNotices(
  db: Db,
  run: Run,
): Promise<void> {
  if (run.messageId === null || (await currentSegmentDispatched(db, run))) {
    return;
  }

  const chat = await new ChatsRepository(db).lock(run.chatId, run.userId);

  if (!chat) return;

  await db
    .update(chatDeliveries)
    .set({
      state: 'pending',
      runId: null,
      deliveredMessageId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatDeliveries.chatId, run.chatId),
        eq(chatDeliveries.ownerUserId, run.userId),
        eq(chatDeliveries.producer, 'job'),
        eq(chatDeliveries.mode, 'notice'),
        eq(chatDeliveries.state, 'delivered'),
        eq(chatDeliveries.runId, run.id),
        eq(chatDeliveries.deliveredMessageId, run.messageId),
      ),
    );
}

async function currentSegmentDispatched(db: Db, run: Run): Promise<boolean> {
  const delivery = await db
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, run.id),
        eq(runs.userId, run.userId),
        eq(runEvents.eventType, 'run.delivered'),
      ),
    )
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  const [requested] = await db
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, run.id),
        eq(runs.userId, run.userId),
        eq(runEvents.eventType, 'model.requested'),
        sql`${runEvents.sequence} > ${delivery[0]?.sequence ?? 0}`,
      ),
    )
    .limit(1);

  return requested !== undefined;
}
