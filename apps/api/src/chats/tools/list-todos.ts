import { z } from 'zod';

import { TodosRepository } from '../todos-repository';
import { type BuiltinTool, type ToolContext, type ToolResult } from './types';

const inputSchema = z.object({}).strict();

/**
 * `list_todos` — read the current chat's todo list. Read-only, chat-scoped from
 * injected context. Needed BEFORE `write_todos`: llame persists only the
 * assistant's final text per turn, so a fresh turn doesn't see prior todos in
 * context and must read them to rewrite the list.
 */
export const listTodosTool: BuiltinTool<Record<string, never>> = {
  name: 'list_todos',
  description:
    'List the current conversation’s todo items (your working plan). Call ' +
    'this before write_todos so you rewrite the full, current list.',
  riskClass: 'read_only',
  inputSchema,
  async execute(_args, context?: ToolContext): Promise<ToolResult> {
    if (!context) {
      return {
        status: 'error',
        type: 'no_context',
        message: 'list_todos requires an execution context.',
      };
    }
    const rows = await context.tenantDb.runAs(context.userId, (tx) =>
      new TodosRepository(tx).list(context.chatId),
    );
    return {
      status: 'success',
      todos: rows.map((t) => ({ content: t.content, status: t.status })),
    };
  },
};
