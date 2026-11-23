/**
 * The reply-side Run lookups: which Run the newest reply's usage names, and the
 * user-message sequence that reply answers. Split out of `runs-repository.ts`
 * so the repository's turn queries read on their own.
 */

import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';

import { chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/** The Run named by the newest reply's usage before `beforeSeq`. */
export async function findLatestReplyRunIdBefore(
  db: Db,
  chatId: string,
  userId: string,
  beforeSeq: number,
): Promise<string | undefined> {
  const runId = sql<string>`(${messages.usage} ->> 'runId')`;

  const [row] = await db
    .select({ runId })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(chats.ownerUserId, userId),
        eq(messages.role, 'assistant'),
        lt(messages.seq, beforeSeq),
        isNotNull(runId),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(1);

  return row?.runId;
}

/** The sequence of the triggering user message a reply answers. */
export async function findTriggerSeq(
  db: Db,
  chatId: string,
  messageId: string | null,
): Promise<number | undefined> {
  if (messageId === null) return undefined;

  const [row] = await db
    .select({ seq: messages.seq })
    .from(messages)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.chatId, chatId),
        eq(messages.role, 'user'),
      ),
    )
    .limit(1);

  return row?.seq;
}
