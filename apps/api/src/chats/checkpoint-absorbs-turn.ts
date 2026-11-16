import { and, eq, gte } from 'drizzle-orm';

import { chats, messages } from '../db/schema';
import type { Db } from '../db/tenant-db.service';

export async function hasCheckpointAbsorbingTurn(
  tx: Db,
  input: { chatId: string; userId: string; userSeq: number },
): Promise<boolean> {
  const [checkpoint] = await tx
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(messages.chatId, input.chatId),
        eq(chats.ownerUserId, input.userId),
        eq(messages.role, 'checkpoint'),
        gte(messages.absorbedThroughSeq, input.userSeq),
      ),
    )
    .limit(1);

  return checkpoint !== undefined;
}
