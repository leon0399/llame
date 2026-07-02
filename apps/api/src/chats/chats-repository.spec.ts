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
  CompactionsRepository,
  MessagesRepository,
  type Db,
} from './chats-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';

// Mock Drizzle db that records the arguments passed to where/values/set so tests can
// assert the scoping appears in the payload. Chain methods return the same object so
// any call order resolves; terminal methods resolve empty.
function makeMockDb() {
  const whereSpy = jest.fn<void, [unknown]>();
  const valuesSpy = jest.fn<void, [unknown]>();
  const setSpy = jest.fn<void, [unknown]>();
  const limitSpy = jest.fn<void, [unknown]>();
  const terminal = {
    execute: jest.fn().mockResolvedValue([]),
    returning: jest.fn().mockResolvedValue([]),
  };

  function chain(): Record<string, jest.Mock> {
    const obj: Record<string, jest.Mock> = {};
    ['from', 'innerJoin', 'orderBy'].forEach((m) => {
      obj[m] = jest.fn(() => ({ ...obj, ...terminal }));
    });
    obj.limit = jest.fn((arg: unknown) => {
      limitSpy(arg);
      return { ...obj, ...terminal };
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
    limitSpy,
  };
}

// Drizzle wraps bound values in Params; compile each captured where-condition to
// SQL + params via the real dialect and assert the id is a bound parameter.
const dialect = new PgDialect();
function whereContains(whereSpy: jest.Mock, value: string | number): boolean {
  return whereSpy.mock.calls.some((call: unknown[]) => {
    try {
      return dialect.sqlToQuery(call[0] as never).params.includes(value);
    } catch {
      return false;
    }
  });
}

function whereSqlContains(whereSpy: jest.Mock, fragment: string): boolean {
  return whereSpy.mock.calls.some((call: unknown[]) => {
    try {
      return dialect.sqlToQuery(call[0] as never).sql.includes(fragment);
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

  it('update scopes the update by chatId AND ownerUserId', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { title: 'New Title' })
      .catch(() => null);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New Title' }),
    );
  });

  it('update with an empty patch issues no write (reads instead of bumping updatedAt)', async () => {
    const { db } = makeMockDb();
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, {})
      .catch(() => null);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalled();
  });

  it('setGeneratedTitle scopes by chatId, ownerUserId, and untitled state (#78)', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new ChatsRepository(db)
      .setGeneratedTitle(chatId, ownerUserId, 'Weather in NYC')
      .catch(() => null);

    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
    // The atomic guard: only a still-untitled chat (title IS NULL) is written, so
    // any title that landed mid-generation (a user rename, or a concurrent
    // generation) is never clobbered.
    expect(whereSqlContains(whereSpy, '"title" is null')).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Weather in NYC' }),
    );
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

  it('findByChatId applies the max seq boundary and requested history limit', async () => {
    const { db, whereSpy, limitSpy } = makeMockDb();
    await new MessagesRepository(db)
      .findByChatId(chatId, ownerUserId, { maxSeq: 42, limit: 100 })
      .catch(() => null);

    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
    expect(whereContains(whereSpy, 42)).toBe(true);
    expect(limitSpy).toHaveBeenCalledWith(100);
  });

  it('findByChatId applies the exclusive sinceSeq lower bound (post-compaction reads, #57)', async () => {
    const { db, whereSpy } = makeMockDb();
    await new MessagesRepository(db)
      .findByChatId(chatId, ownerUserId, { sinceSeq: 7 })
      .catch(() => null);

    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, 7)).toBe(true);
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

describe('CompactionsRepository — owner-scoped + chat-scoped (#57)', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';

  it('findLatestByChatId scopes by chatId AND ownerUserId (join to chats.owner_user_id)', async () => {
    const { db, whereSpy, limitSpy } = makeMockDb();
    await new CompactionsRepository(db)
      .findLatestByChatId(chatId, ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
    expect(limitSpy).toHaveBeenCalledWith(1);
  });

  it('findLatestByChatId can constrain the latest compaction before a turn seq', async () => {
    const { db, whereSpy } = makeMockDb();
    await new CompactionsRepository(db)
      .findLatestByChatId(chatId, ownerUserId, { beforeSeq: 42 })
      .catch(() => null);

    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, chatId)).toBe(true);
    expect(whereContains(whereSpy, 42)).toBe(true);
  });

  it('create inserts carrying chatId, uptoSeq, parentId, and summary', async () => {
    const { db, valuesSpy } = makeMockDb();
    await new CompactionsRepository(db)
      .create({
        chatId,
        uptoSeq: 42,
        parentId: 'compaction-parent',
        summary: 'earlier turns summarized',
        usage: { status: 'completed' },
      })
      .catch(() => null);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        uptoSeq: 42,
        parentId: 'compaction-parent',
        summary: 'earlier turns summarized',
      }),
    );
  });
});

describe('RunsRepository / RunEventsRepository — owner-scoped (#48)', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';
  const runId = 'run-1';

  it('create inserts a run carrying chatId AND userId (tenant boundary)', async () => {
    const { db, valuesSpy } = makeMockDb();
    await new RunsRepository(db)
      .create({ chatId, messageId: 'msg-1', userId: ownerUserId })
      .catch(() => null);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, userId: ownerUserId }),
    );
  });

  it('markStarted scopes by runId AND userId, stamps startedAt, and refuses terminal runs', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new RunsRepository(db)
      .markStarted(runId, ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, runId)).toBe(true);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    // A superseded/cancelled run must never be resurrected into running_model.
    expect(whereContains(whereSpy, 'expired')).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running_model' }),
    );
    const startedArg = setSpy.mock.calls[0]?.[0] as
      | { startedAt?: unknown }
      | undefined;
    expect(startedArg?.startedAt).toBeInstanceOf(Date);
  });

  it('cancelActiveRunsForMessage scopes by messageId AND userId and skips terminal runs', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new RunsRepository(db)
      .cancelActiveRunsForMessage('msg-9', ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, 'msg-9')).toBe(true);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, 'expired')).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('markFinished scopes by runId AND userId and stamps finishedAt + status', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new RunsRepository(db)
      .markFinished(runId, ownerUserId, 'failed', { message: 'boom' })
      .catch(() => null);
    expect(whereContains(whereSpy, runId)).toBe(true);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereSqlContains(whereSpy, 'finished_at')).toBe(true);
    // Terminal states are immutable: the WHERE excludes already-finished runs,
    // so a late stream callback can never overwrite expired/cancelled.
    expect(whereContains(whereSpy, 'expired')).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: { message: 'boom' },
      }),
    );
    const finishedArg = setSpy.mock.calls[0]?.[0] as
      | { finishedAt?: unknown }
      | undefined;
    expect(finishedArg?.finishedAt).toBeInstanceOf(Date);
  });

  it('touchHeartbeat scopes by runId AND userId and stamps heartbeatAt', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new RunsRepository(db)
      .touchHeartbeat(runId, ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, runId)).toBe(true);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(
      (setSpy.mock.calls[0]?.[0] as { heartbeatAt?: unknown }).heartbeatAt,
    ).toBeInstanceOf(Date);
  });

  it('requestCancel scopes by runId AND userId and only touches non-terminal runs', async () => {
    const { db, whereSpy, setSpy } = makeMockDb();
    await new RunsRepository(db)
      .requestCancel(runId, ownerUserId)
      .catch(() => null);
    expect(whereContains(whereSpy, runId)).toBe(true);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, 'expired')).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(
      (setSpy.mock.calls[0]?.[0] as { cancelRequestedAt?: unknown })
        .cancelRequestedAt,
    ).toBeInstanceOf(Date);
  });

  it('append inserts an event carrying runId and eventType', async () => {
    const { db, valuesSpy } = makeMockDb();
    await new RunEventsRepository(db)
      .append(runId, 'run.started', { at: 'now' })
      .catch(() => null);
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId, eventType: 'run.started' }),
    );
  });

  it('listByRunId scopes by runId AND userId with the after-sequence cursor', async () => {
    const { db, whereSpy } = makeMockDb();
    await new RunEventsRepository(db)
      .listByRunId(runId, ownerUserId, { afterSequence: 7 })
      .catch(() => null);
    expect(whereContains(whereSpy, runId)).toBe(true);
    expect(whereContains(whereSpy, ownerUserId)).toBe(true);
    expect(whereContains(whereSpy, 7)).toBe(true);
  });
});
