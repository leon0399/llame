import { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

/**
 * Durable agent memory (first write tool). A `memories` row is a fact the
 * agent chose to persist for a user, retrievable across chats. User-scoped —
 * the tenant boundary, like `chats.owner_user_id`.
 *
 * RLS: `memories_owner` (`user_id = current_setting('app.current_user_id')`).
 * `.enableRLS()` emits only ENABLE; the migration ALSO hand-issues
 * `FORCE ROW LEVEL SECURITY` (Drizzle can't express FORCE — the documented
 * pattern shared with chats/messages/policies; re-add it if regenerating).
 *
 * `content` is DB-capped (`check`) as defense-in-depth beyond the tool's zod
 * cap — an oversized memory can never reach storage regardless of the caller.
 */
export const MEMORY_CONTENT_MAX = 2000;

/**
 * Who created the memory. SECURITY-load-bearing, not just provenance: only
 * `user` memories (typed by the user via the management UI) are auto-injected
 * into the system prompt. `agent` memories (written by the `remember` tool,
 * possibly derived from untrusted tool output) are reachable ONLY via the
 * on-demand `recall` tool — never laundered into the high-trust system slot.
 */
export const memorySource = pgEnum('memory_source', ['user', 'agent']);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // text — FK to users.id which is text (NextAuth convention).
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    // Existing rows + the `remember` tool default to 'agent'; the user-facing
    // POST /me/memories hardcodes 'user' (client can't set it).
    source: memorySource('source').notNull().default('agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('memories_user_created_idx').on(t.userId, t.createdAt),
    check(
      'memories_content_len',
      sql`char_length(${t.content}) BETWEEN 1 AND ${sql.raw(String(MEMORY_CONTENT_MAX))}`,
    ),
    pgPolicy('memories_owner', {
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Memory = InferSelectModel<typeof memories>;
