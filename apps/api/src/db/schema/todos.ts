import { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { chats } from './chats';

/** Todo lifecycle (opencode's 4-state — more expressive than 3, free). */
export const todoStatus = pgEnum('todo_status', [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

/**
 * The agent's durable, CHAT-scoped working plan (v0.5 control primitive;
 * principle #2 "todos are structured data"). Maintained replace-all
 * (delete + reinsert with `position` = array order, one transaction), the
 * pattern both Claude Code and opencode converge on for a single-loop list.
 *
 * Tenant boundary = chat ownership (like messages), enforced by RLS
 * `todos_owner`. `.enableRLS()` emits ENABLE only; the migration hand-appends
 * `FORCE ROW LEVEL SECURITY` (Drizzle can't express FORCE). `content` is
 * DB-capped as defense-in-depth beyond the tool's zod cap.
 */
export const TODO_CONTENT_MAX = 500;

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    status: todoStatus('status').notNull().default('pending'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // UNIQUE: a chat's todo positions are distinct (replace-all assigns
    // 0..n-1) — defense-in-depth so a repo bug can't silently produce
    // duplicate positions that make `list_todos` ordering nondeterministic.
    uniqueIndex('todos_chat_position_idx').on(t.chatId, t.position),
    check(
      'todos_content_len',
      sql`char_length(${t.content}) BETWEEN 1 AND ${sql.raw(String(TODO_CONTENT_MAX))}`,
    ),
    pgPolicy('todos_owner', {
      using: sql`EXISTS (
        SELECT 1 FROM chats c
        WHERE c.id = ${t.chatId}
          AND c.owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type Todo = InferSelectModel<typeof todos>;
