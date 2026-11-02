import { InferSelectModel, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, timestamptz } from '../columns';
import { chats } from './chats';

/**
 * One stored tool result (tool-result-artifacts D1) — a Chat resource, not a
 * replayed record: it lives until the Chat or its owner is deleted. `run_id`
 * carries no foreign key on purpose: a fork copies artifacts but no Runs, so
 * an FK would tie the fork's rows to a Run of the source Chat.
 *
 * NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
 * `FORCE ROW LEVEL SECURITY` (src/db/AGENTS.md P1); re-add FORCE if it is
 * regenerated.
 */
export const toolArtifacts = pgTable(
  'tool_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    /** Chat-local number from `chats.artifact_seq`; the locator's `<n>`. */
    seq: integer('seq').notNull(),
    toolName: text('tool_name').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    runId: uuid('run_id').notNull(),
    /** Known at insert time: the writer runs after the producer stopped. */
    complete: boolean('complete').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // The Chat list reads oldest first; the locator is unique within the Chat.
    unique('tool_artifacts_chat_seq_unique').on(t.chatId, t.seq),
    // Providers and scripted models can reuse a tool call id across Runs, so
    // the call id alone is not a key. A conflict is a failed write, never a
    // lookup of another call's artifact.
    unique('tool_artifacts_chat_run_call_unique').on(
      t.chatId,
      t.runId,
      t.toolCallId,
    ),
    pgPolicy('tool_artifacts_owner_select', {
      for: 'select',
      using: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
    pgPolicy('tool_artifacts_owner_insert', {
      for: 'insert',
      withCheck: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type ToolArtifact = InferSelectModel<typeof toolArtifacts>;

/**
 * One part of an artifact: a `bash` stream, or the single part of every other
 * tool. `content` is the stored bytes, so media parts (#1530) need no schema
 * change. `findings` is the read-time re-check record (`grep` and
 * `web_search`); the re-check itself ships with the store-authority layer.
 */
export const toolArtifactParts = pgTable(
  'tool_artifact_parts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => toolArtifacts.id, { onDelete: 'cascade' }),
    /** The stream name for `bash`, otherwise the empty string. */
    name: text('name').notNull().default(''),
    contentType: text('content_type').notNull(),
    content: bytea('content').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    lineCount: integer('line_count').notNull(),
    findings: jsonb('findings'),
  },
  (t) => [
    // The reader names a part inside its artifact.
    index('tool_artifact_parts_artifact_idx').on(t.artifactId),
    pgPolicy('tool_artifact_parts_owner_select', {
      for: 'select',
      using: sql`artifact_id IN (
        SELECT tool_artifacts.id FROM tool_artifacts
        INNER JOIN chats ON chats.id = tool_artifacts.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
    pgPolicy('tool_artifact_parts_owner_insert', {
      for: 'insert',
      withCheck: sql`artifact_id IN (
        SELECT tool_artifacts.id FROM tool_artifacts
        INNER JOIN chats ON chats.id = tool_artifacts.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type ToolArtifactPart = InferSelectModel<typeof toolArtifactParts>;
