/**
 * ChatsRepository / MessagesRepository unit tests — owner-scoped defense-in-depth.
 *
 * These assert the owner-scoping is actually present in the query payload, not just
 * that a query was issued: inserts carry ownerUserId in `.values`, and read/update
 * `.where` conditions reference the owner id. Removing the owner filter fails these.
 *
 * Real RLS enforcement (cross-tenant isolation) is proven against a live Postgres in
 * chats-rls.integration.spec.ts.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import {
  ChatsRepository,
  MessagesRepository,
  type Db,
} from './chats-repository';

// Mock Drizzle db that records the arguments passed to where/values/set so tests can
// assert the scoping appears in the payload. Chain methods return the same object so
// any call order resolves; terminal methods resolve empty.
function makeMockDb() {
  const whereSpy = jest.fn();
  const valuesSpy = jest.fn();
  const setSpy = jest.fn();
  const terminal = {
    execute: jest.fn().mockResolvedValue([]),
    returning: jest.fn().mockResolvedValue([]),
  };

  function chain(): Record<string, jest.Mock> {
    const obj: Record<string, jest.Mock> = {};
    ['from', 'innerJoin', 'orderBy', 'limit'].forEach((m) => {
      obj[m] = jest.fn(() => ({ ...obj, ...terminal }));
    });
    obj.where = jest.fn((arg: unknown) => {
      whereSpy(arg);
      return { ...obj, ...terminal };
    });
    obj.values = jest.fn((arg: unknown) => {
      valuesSpy(arg);
      return { ...obj, ...terminal };
    });
    obj.set = jest.fn((arg: unknown) => {
      setSpy(arg);
      return { ...obj, ...terminal };
    });
    return { ...obj, ...terminal };
  }

  const db = {
    select: jest.fn(() => chain()),
    insert: jest.fn(() => chain()),
    update: jest.fn(() => chain()),
  };

  return {
    db: db as unknown as Db & {
      select: jest.Mock;
      insert: jest.Mock;
      update: jest.Mock;
    },
    whereSpy,
    valuesSpy,
    setSpy,
  };
}

// Drizzle wraps bound values in Params; compile each captured where-condition to
// SQL + params via the real dialect and assert the id is a bound parameter.
const dialect = new PgDialect();
function whereContains(whereSpy: jest.Mock, value: string): boolean {
  return whereSpy.mock.calls.some((call: unknown[]) => {
    try {
      return dialect.sqlToQuery(call[0] as never).params.includes(value);
    } catch {
      return false;
    }
  });
}

describe('ChatsRepository — owner-scoped queries (defense-in-depth)', () => {
  const ownerUserId = 'owner-123';
  const chatId = 'chat-abc';

  it('findByOwner filters by ownerUserId', async () => {
    const { db, whereSpy } = makeMockDb();
    await new ChatsRepository(db).findByOwner(ownerUserId).catch(() => null);
    expect(db.select).toHaveBeenCalled();
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
  });

  it('findById scopes by chatId AND ownerUserId', async () => {
    const { db, whereSpy } = makeMockDb();
    await new ChatsRepository(db)
      .findById(chatId, ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
  });

  it('create inserts a row carrying ownerUserId', async () => {
    const { db, valuesSpy } = makeMockDb();
    await new ChatsRepository(db)
      .create({ ownerUserId, title: 'Test Chat' })
      .catch(() => null);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId }),
    );
  });

  it('updateTitle scopes the update by chatId AND ownerUserId', async () => {
    const { db, whereSpy } = makeMockDb();
    await new ChatsRepository(db)
      .updateTitle(chatId, ownerUserId, 'New Title')
      .catch(() => null);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
  });
});

describe('MessagesRepository — owner-scoped + chat-scoped', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';

  it('findByChatId scopes by chatId AND ownerUserId (join to chats.owner_user_id)', async () => {
    const { db, whereSpy } = makeMockDb();
    await new MessagesRepository(db)
      .findByChatId(chatId, ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
  });

  it('create inserts carrying chatId and senderUserId', async () => {
    const { db, valuesSpy } = makeMockDb();
    await new MessagesRepository(db)
      .create({
        chatId,
        role: 'user',
        senderUserId: 'user-1',
        parts: [{ type: 'text', text: 'Hello' }],
      })
      .catch(() => null);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, senderUserId: 'user-1' }),
    );
  });
});
