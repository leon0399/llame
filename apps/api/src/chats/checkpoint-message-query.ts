import { and, desc, eq, type SQL } from 'drizzle-orm';
import { chats, messages, type Message } from '../db/schema';
import type { Db } from '../db/tenant-db.service';

type CheckpointMessage = Message & { absorbedThroughSeq: number };

function isCheckpointMessage(row: Message): row is CheckpointMessage {
  return row.absorbedThroughSeq !== null;
}

export async function findCheckpoint(
  db: Db,
  chatId: string,
  ownerUserId: string,
  boundary: SQL,
): Promise<CheckpointMessage | undefined> {
  const [row] = await db
    .select()
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(chats.ownerUserId, ownerUserId),
        eq(messages.role, 'checkpoint'),
        boundary,
      ),
    )
    .orderBy(desc(messages.absorbedThroughSeq))
    .limit(1);

  if (row === undefined || !isCheckpointMessage(row.messages)) {
    return undefined;
  }

  return row.messages;
}
