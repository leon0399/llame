/* eslint-disable @typescript-eslint/no-unsafe-return */

import { searchConversationsTool } from './search-conversations';
import { type ToolContext } from './types';

/**
 * Unit tests with a FAKE ToolContext (no DB). They prove the security-relevant
 * behavior: the scope (userId) comes from context and is passed to runAs; the
 * model's args are only query/limit; results map to snippets; empty is success;
 * a missing context fails closed.
 */

type Row = {
  chatId: string;
  role: string;
  createdAt: Date;
  parts: unknown;
};

function fakeContext(rows: Row[], spy?: { userId?: string }): ToolContext {
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    // runAs returns canned rows and records the userId it was scoped to.
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
    expect(searchConversationsTool.riskClass).toBe('read_only');
    expect(searchConversationsTool.inputSchema.parse({ query: 'hi' })).toEqual({
      query: 'hi',
      limit: 5,
    });
    // No userId/chatId in the schema — the model cannot supply scope.
    expect(() =>
      searchConversationsTool.inputSchema.parse({ query: 'hi', userId: 'x' }),
    ).toThrow();
  });

  it('scopes the read to the context userId (not a model arg) and maps snippets', async () => {
    const spy: { userId?: string } = {};
    const context = fakeContext(
      [
        {
          chatId: 'chat-9',
          role: 'user',
          createdAt: new Date('2026-07-01T12:00:00Z'),
          parts: [{ type: 'text', text: 'I love TypeScript and RLS.' }],
        },
      ],
      spy,
    );

    const result = await searchConversationsTool.execute(
      { query: 'typescript', limit: 5 },
      context,
    );

    expect(spy.userId).toBe('user-A'); // scope came from context
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.results).toEqual([
      {
        chatId: 'chat-9',
        role: 'user',
        at: '2026-07-01T12:00:00.000Z',
        snippet: 'I love TypeScript and RLS.',
      },
    ]);
  });

  it('returns success with an empty list when nothing matches', async () => {
    const result = await searchConversationsTool.execute(
      { query: 'nothing', limit: 5 },
      fakeContext([]),
    );
    expect(result).toEqual({ status: 'success', results: [] });
  });

  it('truncates long snippets and ignores non-text parts', async () => {
    const long = 'x'.repeat(500);
    const result = await searchConversationsTool.execute(
      { query: 'x', limit: 5 },
      fakeContext([
        {
          chatId: 'c',
          role: 'assistant',
          createdAt: new Date('2026-07-01T00:00:00Z'),
          parts: [
            { type: 'reasoning', text: 'ignore me' },
            { type: 'text', text: long },
          ],
        },
      ]),
    );
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const [first] = result.results as { snippet: string }[];
    expect(first.snippet.endsWith('…')).toBe(true);
    expect(first.snippet.length).toBeLessThanOrEqual(201);
    expect(first.snippet).not.toContain('ignore me');
  });

  it('fails closed (structured error) when no execution context is supplied', async () => {
    const result = await searchConversationsTool.execute({
      query: 'hi',
      limit: 5,
    });
    expect(result).toMatchObject({ status: 'error', type: 'no_context' });
  });
});
