import { sql } from 'drizzle-orm';

import type { Message } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { asDouble } from '../testing/support';
import { findCheckpoint } from './checkpoint-message-query';

const message = (absorbedThroughSeq: number | null): Message => ({
  id: '11111111-1111-4111-8111-111111111111',
  chatId: '22222222-2222-4222-8222-222222222222',
  seq: 3,
  role: 'checkpoint',
  senderUserId: null,
  parts: [],
  attachments: [],
  usage: null,
  absorbedThroughSeq,
  inReplyTo: null,
  createdAt: new Date('2026-11-08T00:00:00.000Z'),
  revisedAt: null,
});

function queryResult(rows: Array<{ messages: Message }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    db: asDouble<Db>({ select }),
    select,
    innerJoin,
    where,
    orderBy,
    limit,
  };
}

describe('findCheckpoint', () => {
  it('returns a row that records an absorbed-through boundary', async () => {
    const checkpoint = message(2);
    const query = queryResult([{ messages: checkpoint }]);

    await expect(
      findCheckpoint(query.db, checkpoint.chatId, 'owner-1', sql`true`),
    ).resolves.toBe(checkpoint);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it('ignores rows without a checkpoint boundary and missing rows', async () => {
    const ordinaryMessage = message(null);
    const ordinary = queryResult([{ messages: ordinaryMessage }]);

    await expect(
      findCheckpoint(ordinary.db, ordinaryMessage.chatId, 'owner-1', sql`true`),
    ).resolves.toBeUndefined();

    const missing = queryResult([]);
    await expect(
      findCheckpoint(missing.db, ordinaryMessage.chatId, 'owner-1', sql`true`),
    ).resolves.toBeUndefined();
  });
});
