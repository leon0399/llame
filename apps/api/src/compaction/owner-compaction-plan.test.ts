import type { Message } from '../db/schema';
import {
  MessagesRepository,
  type CheckpointMessage,
} from '../chats/messages-repository';
import { asDouble } from '../testing/support';
import { planOwnerCompaction } from './owner-compaction-plan';

describe('planOwnerCompaction', () => {
  it('allocates the next sequence after an active checkpoint when no newer rows exist', async () => {
    const checkpoint = asDouble<CheckpointMessage>({
      seq: 2,
      absorbedThroughSeq: 8,
      role: 'checkpoint',
      parts: [],
    });

    const checkpointRow = asDouble<Message>({
      id: 'checkpoint-row',
      seq: 2,
      role: 'checkpoint',
      parts: [],
    });

    const findByChatId = vi
      .fn<MessagesRepository['findByChatId']>()
      .mockImplementation((_chatId, _userId, options) =>
        Promise.resolve(options?.sinceSeq === undefined ? [checkpointRow] : []),
      );

    const messages = asDouble<MessagesRepository>({
      findActiveCheckpoint: vi.fn().mockResolvedValue(checkpoint),
      findByChatId,
    });

    const result = await planOwnerCompaction(messages, 'chat-1', 'owner-1');

    expect(result.nextSeq).toBe(9);
    expect(result.plan).toBeNull();
  });
});
