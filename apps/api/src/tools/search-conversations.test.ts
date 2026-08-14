/* eslint-disable @typescript-eslint/no-unsafe-return */

import { drizzle } from 'drizzle-orm/postgres-js';

import { ChatsRepository } from '../chats/chats-repository';
import * as schema from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { searchConversationsTool } from './search-conversations';
import { type ToolContext } from './types';

/**
 * Unit tests with a FAKE ToolContext (no real DB; the repository read is
 * spied). Drizzle's mock DB runs the real `runAs` callback, so these prove the
 * tool boundary without a database: the
 * scope (userId) comes from context; the model's args are only query/limit;
 * rows map to the tool's result shape.
 * Cross-tenant isolation itself is proven on a live Postgres by
 * chats-search.integration.test.ts, which this tool now shares an
 * implementation with (ChatsRepository.searchByOwner) — see D7.
 */

type Row = {
  id: string;
  title: string | null;
  snippet: string | null;
  updatedAt: Date;
};

function fakeContext(rows: Row[], spy?: { userId?: string }): ToolContext {
  const db: Db = drizzle.mock({ schema });
  vi.spyOn(ChatsRepository.prototype, 'searchByOwner').mockResolvedValue(rows);
  const tenantDb: TenantRunner = {
    runAs: <T>(userId: string, fn: (tx: Db) => Promise<T>) => {
      if (spy) spy.userId = userId;
      return fn(db);
    },
  };
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb,
  };
}

describe('search_conversations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is read-only and takes only query/limit from the model', () => {
    expect(searchConversationsTool.classification).toBe('read_only');
    const schema =
      searchConversationsTool.inputSchema as import('zod').ZodTypeAny;
    expect(schema.parse({ query: 'hi' })).toEqual({
      query: 'hi',
      limit: 5,
    });
    expect(() => schema.parse({ query: 'hi', userId: 'x' })).toThrow();
  });

  it('scopes the read to the context userId (not a model arg) and maps rows', async () => {
    const spy: { userId?: string } = {};
    const context = fakeContext(
      [
        {
          id: 'chat-9',
          title: 'TypeScript project',
          snippet: 'I love TypeScript and RLS.',
          updatedAt: new Date('2026-07-01T12:00:00Z'),
        },
      ],
      spy,
    );

    const result = await searchConversationsTool.execute(context, {
      query: 'typescript',
      limit: 5,
    });

    expect(spy.userId).toBe('user-A'); // scope came from context
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.results).toEqual([
      {
        chatId: 'chat-9',
        title: 'TypeScript project',
        snippet: 'I love TypeScript and RLS.',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    ]);
  });

  it('returns success with an empty list when nothing matches', async () => {
    const result = await searchConversationsTool.execute(fakeContext([]), {
      query: 'nothing',
      limit: 5,
    });
    expect(result).toEqual({ status: 'success', results: [] });
  });

  it('carries a null title/snippet through for a title-only or untitled match', async () => {
    const result = await searchConversationsTool.execute(
      fakeContext([
        {
          id: 'c',
          title: null,
          snippet: 'matched by content only',
          updatedAt: new Date('2026-07-01T00:00:00Z'),
        },
      ]),
      { query: 'x', limit: 5 },
    );
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.results).toEqual([
      {
        chatId: 'c',
        title: null,
        snippet: 'matched by content only',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
  });
});
