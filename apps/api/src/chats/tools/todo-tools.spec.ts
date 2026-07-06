/* eslint-disable @typescript-eslint/no-unsafe-return */

import { listTodosTool } from './list-todos';
import { writeTodosTool } from './write-todos';
import { type ToolContext } from './types';

function fakeContext(
  runAs: (userId: string, fn: (tx: unknown) => unknown) => unknown,
): ToolContext {
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb: { runAs } as unknown as ToolContext['tenantDb'],
  };
}

describe('write_todos', () => {
  it('is write_internal and shapes/caps its input', () => {
    expect(writeTodosTool.riskClass).toBe('write_internal');
    expect(
      writeTodosTool.inputSchema.parse({ todos: [{ content: 'a' }] }),
    ).toEqual({ todos: [{ content: 'a', status: 'pending' }] });
    // over the 50-item cap → rejected
    expect(() =>
      writeTodosTool.inputSchema.parse({
        todos: Array.from({ length: 51 }, () => ({ content: 'x' })),
      }),
    ).toThrow();
    // unknown status → rejected
    expect(() =>
      writeTodosTool.inputSchema.parse({
        todos: [{ content: 'a', status: 'x' }],
      }),
    ).toThrow();
    // no chatId in the schema — the model can't choose the scope
    expect(() =>
      writeTodosTool.inputSchema.parse({ todos: [], chatId: 'x' }),
    ).toThrow();
  });

  it('replaces via the chat scope and returns the stored list', async () => {
    let scopedTo: string | undefined;
    const context = fakeContext((userId) => {
      scopedTo = userId;
      return Promise.resolve([
        { content: 'do the thing', status: 'in_progress' },
      ]);
    });
    const result = await writeTodosTool.execute(
      { todos: [{ content: 'do the thing', status: 'in_progress' }] },
      context,
    );
    expect(scopedTo).toBe('user-A');
    expect(result).toEqual({
      status: 'success',
      todos: [{ content: 'do the thing', status: 'in_progress' }],
    });
  });

  it('fails closed when no context is supplied', async () => {
    const result = await writeTodosTool.execute({ todos: [] });
    expect(result).toMatchObject({ status: 'error', type: 'no_context' });
  });
});

describe('list_todos', () => {
  it('is read-only and maps rows to {content, status}', async () => {
    const context = fakeContext(() =>
      Promise.resolve([{ content: 'a', status: 'pending' }]),
    );
    expect(listTodosTool.riskClass).toBe('read_only');
    const result = await listTodosTool.execute({}, context);
    expect(result).toEqual({
      status: 'success',
      todos: [{ content: 'a', status: 'pending' }],
    });
  });

  it('fails closed without a context', async () => {
    expect(await listTodosTool.execute({})).toMatchObject({
      status: 'error',
      type: 'no_context',
    });
  });
});
