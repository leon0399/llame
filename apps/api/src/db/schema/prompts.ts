import { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  check,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

/**
 * A saved prompt template — the user's reusable prompt, inserted in the
 * composer by typing `/<name>` (roadmap v0.5 slash-commands seed). User-scoped:
 * the tenant boundary, like `memories.user_id`.
 *
 * RLS: `prompts_owner` (`user_id = current_setting('app.current_user_id')`).
 * `.enableRLS()` emits only ENABLE; the migration ALSO hand-issues
 * `FORCE ROW LEVEL SECURITY` (Drizzle can't express FORCE — the documented
 * pattern shared with chats/messages/memories; re-add it if regenerating).
 *
 * `name` is the slash trigger, so it is a slug (no whitespace/slashes) —
 * `/<name>` must be unambiguous; UNIQUE per user. Bounds are DB CHECKs
 * (defense-in-depth beyond the DTO).
 */
export const PROMPT_NAME_MAX = 64;
export const PROMPT_CONTENT_MAX = 8000;

export const prompts = pgTable(
  'prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // text — FK to users.id which is text (NextAuth convention).
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // `/<name>` must be unambiguous per user.
    uniqueIndex('prompts_user_name_idx').on(t.userId, t.name),
    check(
      'prompts_name_slug',
      // Slug only — no whitespace/slashes, so `/<name>` matching is exact.
      sql`${t.name} ~ '^[A-Za-z0-9_-]{1,${sql.raw(String(PROMPT_NAME_MAX))}}$'`,
    ),
    check(
      'prompts_content_len',
      sql`char_length(${t.content}) BETWEEN 1 AND ${sql.raw(String(PROMPT_CONTENT_MAX))}`,
    ),
    pgPolicy('prompts_owner', {
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Prompt = InferSelectModel<typeof prompts>;
