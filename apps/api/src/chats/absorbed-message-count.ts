/**
 * Per-checkpoint absorbed-message counts (split from messages-repository.ts,
 * which delegates `countAbsorbedMessages` here to stay under the file-size cap).
 */
import {
  and,
  count,
  eq,
  gt,
  inArray,
  lt,
  lte,
  max,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

const checkpoint = alias(messages, 'checkpoint');
const previous = alias(messages, 'previous_checkpoint');

/**
 * The nearest lower `absorbed_through_seq` in the checkpoint's chat, or 0 for
 * the first checkpoint; served by the partial boundary index.
 */
function previousBoundary(db: Db): SQL {
  return sql`coalesce(${db
    .select({ value: max(previous.absorbedThroughSeq) })
    .from(previous)
    .where(
      and(
        eq(previous.chatId, checkpoint.chatId),
        lt(previous.absorbedThroughSeq, checkpoint.absorbedThroughSeq),
      ),
    )}, 0)`;
}

/**
 * User and assistant rows each checkpoint absorbed (after the previous
 * checkpoint boundary, up to its own), counted in one grouped query for the
 * requested checkpoints of one owned chat. A checkpoint that absorbed nothing
 * maps to 0.
 */
export async function countAbsorbedMessages(
  db: Db,
  chatId: string,
  ownerUserId: string,
  checkpointIds: ReadonlyArray<string>,
): Promise<Map<string, number>> {
  if (checkpointIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ checkpointId: checkpoint.id, value: count(messages.id) })
    .from(checkpoint)
    .innerJoin(chats, eq(checkpoint.chatId, chats.id))
    .leftJoin(
      messages,
      and(
        eq(messages.chatId, checkpoint.chatId),
        inArray(messages.role, ['user', 'assistant']),
        lte(messages.seq, checkpoint.absorbedThroughSeq),
        gt(messages.seq, previousBoundary(db)),
      ),
    )
    .where(
      and(
        eq(checkpoint.chatId, chatId),
        eq(chats.ownerUserId, ownerUserId),
        eq(checkpoint.role, 'checkpoint'),
        inArray(checkpoint.id, [...checkpointIds]),
      ),
    )
    .groupBy(checkpoint.id);

  return new Map(rows.map(({ checkpointId, value }) => [checkpointId, value]));
}
