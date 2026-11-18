import { and, desc, eq, sql } from 'drizzle-orm';

import { type Message, chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/** Hides in-flight assistant replies until their Run reaches a terminal state. */
export const notRunningReply = sql`(${messages.usage} ->> 'status') is distinct from 'running'`;
export const titleMessageRoles = sql`(${messages.role} = 'assistant' or (${messages.role} = 'user' and ${messages.senderUserId} is not null))`;

/** Recent title input rows, newest-first and owned by the requested user. */
export async function queryLatestTitleMessages(
  db: Db,
  chatId: string,
  ownerUserId: string,
): Promise<Array<Message>> {
  const rows = await db
    .select({ messages })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(chats.ownerUserId, ownerUserId),
        titleMessageRoles,
        notRunningReply,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(144);

  return rows.map((row) => row.messages);
}
