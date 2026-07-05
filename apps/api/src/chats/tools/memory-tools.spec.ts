/* eslint-disable @typescript-eslint/no-unsafe-return */

import { recallTool } from './recall';
import { rememberTool } from './remember';
import { type ToolContext } from './types';

/**
 * Unit tests with a FAKE ToolContext (no DB). Prove: scope comes from context
 * (not a model arg), the schemas cap/shape input, results map correctly, and a
 * missing context fails closed. The RLS cross-tenant property is proven in the
 * integration suite.
 */

function fakeContext(
  runAs: (userId: string, fn: (tx: unknown) => unknown) => unknown,
): ToolContext {
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb: { runAs } as unknown as ToolContext['tenantDb'],
  };
}

describe('remember', () => {
  it('is write_internal and only accepts capped content (no userId in schema)', () => {
    expect(rememberTool.riskClass).toBe('write_internal');
    expect(rememberTool.inputSchema.parse({ content: 'hi' })).toEqual({
      content: 'hi',
    });
    expect(() =>
      rememberTool.inputSchema.parse({ content: 'hi', userId: 'x' }),
    ).toThrow();
    expect(() =>
      rememberTool.inputSchema.parse({ content: 'x'.repeat(2001) }),
    ).toThrow();
  });

  it('persists via the injected context scope and reports success', async () => {
    let scopedTo: string | undefined;
    const context = fakeContext((userId, fn) => {
      scopedTo = userId;
      // A fake tx whose repo methods the tool calls: countByUser → 0, create → ok.
      return fn({
        select: () => ({
          from: () => ({ where: () => Promise.resolve([{ n: 0 }]) }),
        }),
        insert: () => ({
          values: () => ({ returning: () => Promise.resolve([{ id: 'm1' }]) }),
        }),
      });
    });

    const result = await rememberTool.execute(
      { content: 'Leo likes RLS' },
      context,
    );
    expect(scopedTo).toBe('user-A');
    expect(result).toEqual({ status: 'success', saved: true });
  });

  it('fails closed with a structured error when no context is supplied', async () => {
    const result = await rememberTool.execute({ content: 'x' });
    expect(result).toMatchObject({ status: 'error', type: 'no_context' });
  });

  it('rejects at the per-user cap without saving', async () => {
    const context = fakeContext((_userId, fn) =>
      fn({
        select: () => ({
          from: () => ({ where: () => Promise.resolve([{ n: 1000 }]) }),
        }),
        insert: () => {
          throw new Error('should not insert at cap');
        },
      }),
    );
    const result = await rememberTool.execute({ content: 'x' }, context);
    expect(result).toMatchObject({ status: 'error', type: 'memory_full' });
  });
});

describe('recall', () => {
  it('is read-only and takes only query/limit', () => {
    expect(recallTool.riskClass).toBe('read_only');
    expect(recallTool.inputSchema.parse({ query: 'hi' })).toEqual({
      query: 'hi',
      limit: 5,
    });
  });

  it('maps memories to {content, at} using the context scope', async () => {
    let scopedTo: string | undefined;
    const context = fakeContext((userId) => {
      scopedTo = userId;
      return Promise.resolve([
        {
          content: 'Leo likes RLS',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ]);
    });
    const result = await recallTool.execute(
      { query: 'RLS', limit: 5 },
      context,
    );
    expect(scopedTo).toBe('user-A');
    expect(result).toMatchObject({
      status: 'success',
      memories: [{ content: 'Leo likes RLS', at: '2026-07-01T00:00:00.000Z' }],
    });
    // Explicit distrust framing accompanies recalled content.
    if (result.status === 'success') {
      expect(typeof result.note).toBe('string');
    }
  });

  it('empty result is success; missing context fails closed', async () => {
    const empty = await recallTool.execute(
      { query: 'x', limit: 5 },
      fakeContext(() => Promise.resolve([])),
    );
    expect(empty).toMatchObject({ status: 'success', memories: [] });

    const noCtx = await recallTool.execute({ query: 'x', limit: 5 });
    expect(noCtx).toMatchObject({ status: 'error', type: 'no_context' });
  });
});
