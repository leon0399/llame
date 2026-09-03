import { InferSelectModel, sql } from 'drizzle-orm';
import { boolean, pgPolicy, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { users } from './auth';

// One owner-scoped memory-settings row per user. Absence is the natural
// default and resolves identically to an explicit false setting.
//
// This is separate from personalization because authored-profile consent and
// access to conversation history are independent axes with different blast
// radii. `share_recent_chats` therefore defaults false: enabling it moves
// conversation-derived content the owner did not author for that purpose.
//
// NOTE: `.enableRLS()` only emits ENABLE. The generated migration ALSO issues
// `FORCE ROW LEVEL SECURITY` because the serving role owns the table and would
// otherwise bypass every policy below.
export const memorySettings = pgTable(
  'memory_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    shareRecentChats: boolean('share_recent_chats').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  () => [
    // No public-read branch: a shared chat or empty identity must never expose
    // whether its owner consented to history access.
    pgPolicy('memory_settings_owner_select', {
      for: 'select',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('memory_settings_owner_insert', {
      for: 'insert',
      withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('memory_settings_owner_update', {
      for: 'update',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('memory_settings_owner_delete', {
      for: 'delete',
      using: sql`user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type MemorySettings = InferSelectModel<typeof memorySettings>;
