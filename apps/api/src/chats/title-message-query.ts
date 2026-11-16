import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm';

import { type Message, chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

const notRunningReply = sql`(${messages.usage} ->> 'status') is distinct from 'running'`;

/** Recent title input rows, newest-first and owned by the requested user. */
export async function queryLatestTitleMessages(
  db: Db,
  chatId: string,
  ownerUserId: string,
): Promise<Array<Message>> {
  const rows = await db
    .select()
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(chats.ownerUserId, ownerUserId),
        or(
          eq(messages.role, 'assistant'),
          and(eq(messages.role, 'user'), isNotNull(messages.senderUserId)),
        ),
        notRunningReply,
      ),
    )
    .orderBy(desc(messages.seq));

  return rows.map((row) => row.messages);
}
