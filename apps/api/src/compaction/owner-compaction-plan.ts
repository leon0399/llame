import type {
  CheckpointMessage,
  MessagesRepository,
} from '../chats/messages-repository';
import {
  planCompactionCheckpoint,
  toStoredMessages,
  type CompactionPlan,
} from './compaction';

export type OwnerCompactionPlan = {
  nextSeq: number;
  activeCheckpoint: CheckpointMessage | undefined;
  plan: CompactionPlan | null;
};

export async function planOwnerCompaction(
  messages: MessagesRepository,
  chatId: string,
  userId: string,
): Promise<OwnerCompactionPlan> {
  const activeCheckpoint = await messages.findActiveCheckpoint(chatId, userId, {
    beforeSeq: Number.MAX_SAFE_INTEGER,
  });

  const rows = await messages.findByChatId(chatId, userId, {
    sinceSeq: activeCheckpoint?.absorbedThroughSeq,
  });

  const nextSeq =
    (rows.at(-1)?.seq ?? activeCheckpoint?.absorbedThroughSeq ?? 0) + 1;

  return {
    nextSeq,
    activeCheckpoint,
    plan: planCompactionCheckpoint({
      rows: toStoredMessages(rows),
      boundarySeq: activeCheckpoint?.absorbedThroughSeq ?? 0,
      triggeringUserSeq: nextSeq,
    }),
  };
}
