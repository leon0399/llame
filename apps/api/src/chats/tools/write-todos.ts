import { z } from 'zod';

import { TODO_CONTENT_MAX } from '../../db/schema';
import {
  TodosRepository,
  TODOS_MAX_PER_CHAT,
  type TodoStatus,
} from '../todos-repository';
import { type BuiltinTool, type ToolContext, type ToolResult } from './types';

const inputSchema = z
  .object({
    todos: z
      .array(
        z
          .object({
            content: z.string().min(1).max(TODO_CONTENT_MAX),
            status: z
              .enum(['pending', 'in_progress', 'completed', 'cancelled'])
              .default('pending'),
          })
          .strict(),
      )
      .max(TODOS_MAX_PER_CHAT)
      .describe('The full, updated todo list — REPLACES the current list.'),
  })
  .strict();

/**
 * `write_todos` — REPLACE the current chat's todo list with the given items
 * (the replace-all pattern Claude Code + opencode converge on). Chat-scoped
 * from injected context.
 *
 * `write_internal` and DEFAULT-DENY (not in the safe allowlist): it is a WRITE,
 * and replace-all (delete-then-reinsert) is STRICTLY more destructive than the
 * append-only `remember` — an omitted item is deleted, and a mistaken empty
 * call clears the plan. So, like `remember`, it is enabled only by an operator
 * (`TOOLS_ENABLED=write_todos`) or an explicit policy allow.
 */
export const writeTodosTool: BuiltinTool<{
  todos: { content: string; status: TodoStatus }[];
}> = {
  name: 'write_todos',
  description:
    'Replace your working plan for this conversation with the given todo ' +
    'list. Send the FULL list every time — items you omit are removed. Read ' +
    'the current list with list_todos first. Statuses: pending, in_progress, ' +
    'completed, cancelled.',
  riskClass: 'write_internal',
  inputSchema,
  async execute({ todos }, context?: ToolContext): Promise<ToolResult> {
    if (!context) {
      return {
        status: 'error',
        type: 'no_context',
        message: 'write_todos requires an execution context.',
      };
    }
    try {
      const rows = await context.tenantDb.runAs(context.userId, (tx) =>
        new TodosRepository(tx).replace(context.chatId, todos),
      );
      return {
        status: 'success',
        todos: rows.map((t) => ({ content: t.content, status: t.status })),
      };
    } catch {
      return {
        status: 'error',
        type: 'write_todos_failed',
        message: 'The todo list could not be saved.',
      };
    }
  },
};
