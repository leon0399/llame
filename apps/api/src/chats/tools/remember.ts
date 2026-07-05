import { z } from 'zod';

import { MEMORY_CONTENT_MAX } from '../../db/schema';
import {
  MemoriesRepository,
  MEMORY_MAX_PER_USER,
} from '../memories-repository';
import { type BuiltinTool, type ToolContext, type ToolResult } from './types';

class MemoryFullError extends Error {
  constructor(readonly count: number) {
    super('memory full');
  }
}

const inputSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(MEMORY_CONTENT_MAX)
      .describe('The fact to remember, in one concise sentence.'),
  })
  .strict();

/**
 * `remember` — the first WRITE tool. Persists one fact to the user's own
 * durable memory (recallable across chats). Own-scope from injected context
 * (never a model arg); reversible; no external effect. Capped per user to
 * bound growth. write_internal risk class: a durable, cross-session,
 * model-recalled record is admitted only by an explicit policy allow, never
 * default-available like the read tools.
 */
export const rememberTool: BuiltinTool<{ content: string }> = {
  name: 'remember',
  description:
    'Save a durable fact about the user or their work so you can recall it in ' +
    'later conversations (e.g. a stable preference or an important detail). ' +
    'Use sparingly for lasting facts, not transient chatter. Only the user’s ' +
    'own memory is written.',
  riskClass: 'write_internal',
  inputSchema,
  async execute({ content }, context?: ToolContext): Promise<ToolResult> {
    if (!context) {
      return {
        status: 'error',
        type: 'no_context',
        message: 'remember requires an execution context.',
      };
    }
    try {
      await context.tenantDb.runAs(context.userId, async (tx) => {
        const repo = new MemoriesRepository(tx);
        // Check + insert in ONE transaction so the cap can't be raced past.
        const count = await repo.countByUser(context.userId);
        if (count >= MEMORY_MAX_PER_USER) {
          throw new MemoryFullError(count);
        }
        return repo.create(context.userId, content);
      });
      return { status: 'success', saved: true };
    } catch (error) {
      if (error instanceof MemoryFullError) {
        return {
          status: 'error',
          type: 'memory_full',
          message: `Memory is full (${error.count}/${MEMORY_MAX_PER_USER}); nothing was saved.`,
        };
      }
      return {
        status: 'error',
        type: 'remember_failed',
        message: 'The memory could not be saved.',
      };
    }
  },
};
