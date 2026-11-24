import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { type Message, chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { eligibleMessagePredicate } from './message-eligibility';
import { hasVisibleText } from './title-message-query';

/** Latest immutable assistant excerpt source for a bounded owned Chat set. */
export async function findLatestAssistantPerOwnedChat(
  db: Db,
  chatIds: ReadonlyArray<string>,
  ownerUserId: string,
): Promise<Array<Message>> {
  if (chatIds.length === 0) return [];

  const rows = await db
    .selectDistinctOn([messages.chatId])
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.ownerUserId, ownerUserId),
        inArray(messages.chatId, [...chatIds]),
        eq(messages.role, 'assistant'),
        eligibleMessagePredicate('messages'),
        hasVisibleText,
      ),
    )
    .orderBy(messages.chatId, desc(messages.seq));

  return rows.map((row) => row.messages);
}

/** Earliest owner-authored user message per Chat: the opening excerpt source. */
export async function findEarliestUserMessagePerChat(
  db: Db,
  chatIds: ReadonlyArray<string>,
  ownerUserId: string,
): Promise<Array<Message>> {
  if (chatIds.length === 0) return [];

  const rows = await db
    .selectDistinctOn([messages.chatId])
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.ownerUserId, ownerUserId),
        inArray(messages.chatId, [...chatIds]),
        sql`(${messages.role} = 'user' and ${messages.senderUserId} is not null)`,
      ),
    )
    .orderBy(messages.chatId, asc(messages.seq));

  return rows.map((row) => row.messages);
}

/** Count immutable evidence messages for a bounded set of owned Chats. */
export async function countEligiblePerOwnedChat(
  db: Db,
  chatIds: ReadonlyArray<string>,
  ownerUserId: string,
): Promise<Map<string, number>> {
  if (chatIds.length === 0) return new Map();

  const rows = await db
    .select({ chatId: messages.chatId, value: count() })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.ownerUserId, ownerUserId),
        inArray(messages.chatId, [...chatIds]),
        eligibleMessagePredicate('messages'),
      ),
    )
    .groupBy(messages.chatId);

  return new Map(rows.map(({ chatId, value }) => [chatId, value]));
}
