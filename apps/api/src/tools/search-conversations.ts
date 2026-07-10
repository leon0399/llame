import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { ChatsRepository } from '../chats/chats-repository';
import { type Tool, type ToolContext, type ToolResult } from './types';

const logger = new Logger('SearchConversationsTool');

const inputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe('Keywords to find in the user’s own chats.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('Max results (1–10, default 5).'),
  })
  .strict();

/**
 * `search_conversations` (D7) — the slice's ONE tool: conversation search over
 * the run owner's own chats. Wired through the EXACT SAME repository method
 * (`ChatsRepository.searchByOwner`) the web chat search's `ChatsService.
 * searchChats` calls — same tenant-scoped SQL, no parallel query path. A
 * genuine service-level dependency (RunExecutionService -> ChatsService)
 * would create a module cycle (ChatsModule already imports RunWorkerModule);
 * calling the shared repository method under `tenantDb.runAs` avoids that
 * without duplicating the query, matching how this file's neighbors
 * (run-execution.service.ts) already import ChatsRepository directly.
 *
 * The user scope (`context.userId`) is INJECTED by the run loop, never a
 * model argument — the model supplies only `query`/`limit`, so it cannot
 * widen the scope. RLS scopes the read to the user regardless.
 */
export const searchConversationsTool: Tool<{ query: string; limit: number }> =
  {
    id: 'search_conversations',
    description:
      'Search the user’s own chats by keyword (matches chat titles and ' +
      'message content). Use to recall something the user said before that ' +
      'is no longer in view. Returns short snippets; it only sees this ' +
      'user’s own chats.',
    classification: 'read_only',
    inputSchema,
    async execute(
      context: ToolContext,
      { query, limit }: { query: string; limit: number },
    ): Promise<ToolResult> {
      try {
        const rows = await context.tenantDb.runAs(context.userId, (tx) =>
          new ChatsRepository(tx).searchByOwner(context.userId, query, limit),
        );
        return {
          status: 'success',
          results: rows.map((r) => ({
            chatId: r.id,
            title: r.title,
            snippet: r.snippet,
            // `searchByOwner` runs a raw `db.execute(sql\`...\`)` (not the
            // typed query builder), so postgres.js may hand back `updatedAt`
            // as a string rather than a coerced Date depending on driver
            // config — `new Date(...)` normalizes either shape before
            // calling `toISOString()`.
            updatedAt: new Date(r.updatedAt).toISOString(),
          })),
        };
      } catch (error) {
        // A failure (e.g. the statement_timeout tripping on a huge history) is
        // a structured observation, not a thrown exception. Still logged: a
        // silent catch would hide real operational issues behind an identical
        // "try narrower keywords" message.
        logger.error(
          `search_conversations failed for user ${context.userId}`,
          error instanceof Error ? error.stack : String(error),
        );
        return {
          status: 'error',
          type: 'search_failed',
          message: 'The search could not complete. Try more specific keywords.',
        };
      }
    },
  };
