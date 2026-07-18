import { InferSelectModel, sql } from 'drizzle-orm';
import {
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

export type ModelToolDeclaration = {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const modelContextPromptSource = pgEnum('model_context_prompt_source', [
  'project_default',
  'model_override',
]);

/**
 * The exact model-facing prompt and tool declarations bound to a run.
 *
 * Snapshots are immutable by construction: RLS grants owner SELECT and INSERT
 * only, and the repository deliberately exposes no update/delete operations.
 * The migration also FORCEs RLS because Drizzle can express ENABLE only.
 */
export const modelContextSnapshots = pgTable(
  'model_context_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    promptHash: text('prompt_hash').notNull(),
    toolHash: text('tool_hash').notNull(),
    source: modelContextPromptSource('source').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    toolDeclarations: jsonb('tool_declarations')
      .$type<ModelToolDeclaration[]>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite target for runs(snapshot_id, user_id): a run can bind only a
    // snapshot owned by the same tenant.
    uniqueIndex('model_context_snapshots_id_owner_user_id_unique_idx').on(
      t.id,
      t.ownerUserId,
    ),
    // The source kind is provenance rather than hashed content. Two otherwise
    // identical prompts from different sources remain distinct receipts.
    uniqueIndex('model_context_snapshots_owner_content_source_unique_idx').on(
      t.ownerUserId,
      t.contentHash,
      t.source,
    ),
    pgPolicy('model_context_snapshots_owner_select', {
      for: 'select',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
    pgPolicy('model_context_snapshots_owner_insert', {
      for: 'insert',
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type ModelContextSnapshot = InferSelectModel<
  typeof modelContextSnapshots
>;
