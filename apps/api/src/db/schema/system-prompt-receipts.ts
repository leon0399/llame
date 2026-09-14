import { InferSelectModel, sql } from 'drizzle-orm';
import {
  foreignKey,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';

import { runs } from './chats';
import { modelContextPromptSource } from './model-context';
import { users } from './auth';

/**
 * Immutable system-prompt-only receipt per execution attempt. Tool catalogs,
 * schemas, descriptions, and availability state remain worker-local.
 */
export const systemPromptReceipts = pgTable(
  'system_prompt_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    source: modelContextPromptSource('source').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    promptHash: text('prompt_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'system_prompt_receipts_run_id_user_id_fk',
      columns: [t.runId, t.ownerUserId],
      foreignColumns: [runs.id, runs.userId],
    }).onDelete('cascade'),
    uniqueIndex('system_prompt_receipts_owner_run_attempt_uidx').on(
      t.ownerUserId,
      t.runId,
      t.attemptId,
    ),
    pgPolicy('system_prompt_receipts_owner_select', {
      for: 'select',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('system_prompt_receipts_owner_insert', {
      for: 'insert',
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type SystemPromptReceipt = InferSelectModel<typeof systemPromptReceipts>;
