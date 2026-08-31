import { InferSelectModel, sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';

import { users } from './auth';

/**
 * One portable logical Knowledge Space authority row per owner.
 *
 * The local filesystem root and stable-ID child are deliberately not stored in
 * PostgreSQL. The configured root is process-local operator state; this row is
 * only the tenant-owned identity anchor used to derive that child safely.
 * `.enableRLS()` emits ENABLE; the migration additionally FORCEs RLS because
 * the serving role owns this table.
 */
export const knowledgeSpaces = pgTable(
  'knowledge_spaces',
  {
    knowledgeSpaceId: uuid('knowledge_space_id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Personal'),
    createdAt: timestamptz('created_at', { precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamptz('updated_at', { precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('knowledge_spaces_owner_created_id_idx').on(
      table.ownerUserId,
      table.createdAt,
      table.knowledgeSpaceId,
    ),
    pgPolicy('knowledge_spaces_owner_select', {
      for: 'select',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('knowledge_spaces_owner_insert', {
      for: 'insert',
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('knowledge_spaces_owner_update', {
      for: 'update',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('knowledge_spaces_owner_delete', {
      for: 'delete',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type KnowledgeSpace = InferSelectModel<typeof knowledgeSpaces>;
