import { InferSelectModel, sql } from 'drizzle-orm';
import {
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';

import { users } from './auth';
import { type ToolAvailabilityManifest } from '../../tools/turn-tool-catalog';
import { type JsonSchemaDocument } from '../../tools/types';

export type ModelToolDeclaration = {
  id: string;
  description: string;
  inputSchema: JsonSchemaDocument;
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
    availabilityHash: text('availability_hash').notNull(),
    promptHash: text('prompt_hash').notNull(),
    toolHash: text('tool_hash').notNull(),
    source: modelContextPromptSource('source').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    toolAvailabilityManifest: jsonb('tool_availability_manifest')
      .$type<ToolAvailabilityManifest>()
      .notNull(),
    toolDeclarations: jsonb('tool_declarations')
      .$type<Array<ModelToolDeclaration>>()
      .notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
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
    uniqueIndex('model_context_snapshots_owner_content_avail_source_uidx').on(
      t.ownerUserId,
      t.contentHash,
      t.availabilityHash,
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

/**
 * System-prompt-only receipt per execution attempt. Each attempt that reaches
 * prompt preparation records its rendered system text, prompt hash, and source.
 * Unique on (owner, run, attempt) — no content-addressed dedup.
 *
 * Immutable by construction: RLS grants owner SELECT and INSERT only.
 * The migration FORCEs RLS because Drizzle can express ENABLE only.
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
    // Unique receipt per owner/run/attempt — no content-addressed dedup.
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

/**
 * Minimal availability record per successfully committed turn: sorted tool
 * ids and their available/unavailable state. Contains no schema, description,
 * template, hash, endpoint, or failure detail.
 *
 * Written only in successful-turn finalization, not during claim or receipt
 * preparation. Empty observed state is `[]`; absence means no committed
 * observation. Owner-scoped via the run's chat ownership.
 */
export type TurnToolAvailabilityEntry = {
  id: string;
  state: 'available' | 'unavailable';
};
