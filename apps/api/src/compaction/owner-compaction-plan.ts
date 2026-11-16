import { type MessagesRepository } from '../chats/messages-repository';
import { toStoredMessages } from './compaction.service';
import { planCompactionCheckpoint } from './compaction';

export async function planOwnerCompaction(
  messages: MessagesRepository,
  chatId: string,
  userId: string,
) {
  const active = await messages.findActiveCheckpoint(chatId, userId, {
    beforeSeq: Number.MAX_SAFE_INTEGER,
  });

  const rows = await messages.findByChatId(chatId, userId, {
    sinceSeq: active?.absorbedThroughSeq,
  });

  const nextSeq = (rows.at(-1)?.seq ?? active?.absorbedThroughSeq ?? 0) + 1;

  return {
    nextSeq,
    plan: planCompactionCheckpoint({
      rows: toStoredMessages(rows),
      boundarySeq: active?.absorbedThroughSeq ?? 0,
      triggeringUserSeq: nextSeq,
    }),
  };
}
