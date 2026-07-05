import { z } from 'zod';

import { MessagesRepository } from '../chats-repository';
import { type BuiltinTool, type ToolContext, type ToolResult } from './types';

const inputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe('Keywords to find in the user’s past messages.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('Max results (1–10, default 5).'),
  })
  .strict();

/** Per-result snippet cap and overall bound (just-in-time retrieval: concise). */
const SNIPPET_CHARS = 200;

function snippetOf(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  const text = parts
    .filter(
      (p): p is { type: string; text: string } =>
        typeof p === 'object' &&
        p !== null &&
        (p as { type?: unknown }).type === 'text' &&
        typeof (p as { text?: unknown }).text === 'string',
    )
    .map((p) => p.text)
    .join(' ')
    .trim();
  return text.length > SNIPPET_CHARS
    ? `${text.slice(0, SNIPPET_CHARS)}…`
    : text;
}

/**
 * `search_conversations` — the first context-aware, data-reading tool. Searches
 * the AUTHENTICATED user's own past messages across their chats (memory beyond
 * the live context window / what compaction summarized away). The user scope
 * (`context.userId`) is INJECTED by the run loop, never a model argument — the
 * model supplies only `query`/`limit`, so it cannot widen the scope. RLS scopes
 * the read to the user regardless.
 */
export const searchConversationsTool: BuiltinTool<{
  query: string;
  limit: number;
}> = {
  name: 'search_conversations',
  description:
    'Search the user’s own earlier messages across their conversations by ' +
    'keyword. Use to recall something the user said before that is no longer ' +
    'in view. Returns short snippets; it only sees this user’s own history.',
  riskClass: 'read_only',
  inputSchema,
  async execute({ query, limit }, context?: ToolContext): Promise<ToolResult> {
    if (!context) {
      // Defensive: the run loop always injects context; a call without it is a
      // programming error, and — critically — a data read with no trusted
      // scope must fail closed, never run unscoped.
      return {
        status: 'error',
        type: 'no_context',
        message: 'search_conversations requires an execution context.',
      };
    }
    try {
      const rows = await context.tenantDb.runAs(context.userId, (tx) =>
        new MessagesRepository(tx).search(query, context.userId, limit),
      );
      return {
        status: 'success',
        results: rows.map((m) => ({
          chatId: m.chatId,
          role: m.role,
          at: m.createdAt.toISOString(),
          snippet: snippetOf(m.parts),
        })),
      };
    } catch {
      // A failure (e.g. the statement_timeout tripping on a huge history) is a
      // structured observation, not a thrown exception — the model can retry
      // with a narrower query.
      return {
        status: 'error',
        type: 'search_failed',
        message: 'The search could not complete. Try more specific keywords.',
      };
    }
  },
};
