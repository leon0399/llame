/* eslint-disable @typescript-eslint/no-unsafe-return */

import { searchConversationsTool } from './search-conversations';
import { type ToolContext } from './types';

/**
 * Unit tests with a FAKE ToolContext (no DB, no real ChatsRepository call —
 * the fake `runAs` never invokes its callback, so these prove only the
 * tool-boundary behavior): the scope (userId) comes from context; the
 * model's args are only query/limit; rows map to the tool's result shape.
 * Cross-tenant isolation itself is proven on a live Postgres by
 * chats-search.integration.spec.ts, which this tool now shares an
 * implementation with (ChatsRepository.searchByOwner) — see D7.
 */

type Row = {
  id: string;
  title: string | null;
  snippet: string | null;
  updatedAt: Date;
};

function fakeContext(rows: Row[], spy?: { userId?: string }): ToolContext {
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb: {
      runAs: (userId: string) => {
        if (spy) spy.userId = userId;
        return Promise.resolve(rows);
      },
    } as unknown as ToolContext['tenantDb'],
  };
}

describe('search_conversations', () => {
  it('is read-only and takes only query/limit from the model', () => {
    expect(searchConversationsTool.classification).toBe('read_only');
    expect(searchConversationsTool.inputSchema.parse({ query: 'hi' })).toEqual(
      { query: 'hi', limit: 5 },
    );
    // No userId/chatId in the schema — the model cannot supply scope.
    expect(() =>
      searchConversationsTool.inputSchema.parse({ query: 'hi', userId: 'x' }),
    ).toThrow();
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
