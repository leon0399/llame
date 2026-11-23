import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import type { ChatDelivery } from '../db/schema';
import { readCompactionSet } from './boundary-compaction';

const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'owner-1';
const now = new Date('2026-09-01T00:00:00.000Z');

function delivery(input: {
  id: string;
  producer?: ChatDelivery['producer'];
  mode: ChatDelivery['mode'];
  text: string;
}): ChatDelivery {
  return {
    id: input.id,
    chatId,
    ownerUserId: ownerId,
    producer: input.producer ?? 'owner',
    senderRef: null,
    mode: input.mode,
    parts: [{ type: 'text', text: input.text }],
    settings: { selector: 'model', permissionMode: 'default' },
    state: 'pending',
    position: 1,
    deliveredMessageId: null,
    runId: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('readCompactionSet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads pending compact steer and interrupt items in order and takes first focus', async () => {
    const db: Db = drizzle.mock();

    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });

    vi.spyOn(tenantDb, 'runAs').mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );

    vi.spyOn(
      ChatDeliveriesRepository.prototype,
      'listPending',
    ).mockResolvedValue([
      delivery({ id: 'first', mode: 'steer', text: '/compact First focus' }),
      delivery({ id: 'message', mode: 'steer', text: 'ordinary message' }),
      delivery({ id: 'queued', mode: 'queue', text: '/compact not admitted' }),
      delivery({
        id: 'notice',
        producer: 'job',
        mode: 'notice',
        text: '/compact no',
      }),
      delivery({
        id: 'second',
        mode: 'interrupt',
        text: '/compact Second focus',
      }),
    ]);

    await expect(
      readCompactionSet({ tenantDb, chatId, userId: ownerId }),
    ).resolves.toEqual({
      ids: ['first', 'second'],
      focus: 'First focus',
    });
  });
});
