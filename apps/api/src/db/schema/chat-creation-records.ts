import { InferSelectModel, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import type { PermissionDecision } from '../../tools/permissions/types';
import { users } from './auth';
import { chats } from './chats';

/** One decided path of an attempt, with its admission provenance. */
export type ChatCreationPathDecision = {
  /** The decided path, as the Workspace step names it. */
  readonly path: string;
  /** The admission decision, which already holds only safe provenance. */
  readonly decision: PermissionDecision;
};

/** One create or resend: its own `created_at` and every path decision. */
export type ChatCreationAttempt = {
  readonly createdAt: string;
  readonly decisions: ReadonlyArray<ChatCreationPathDecision>;
};

/**
 * The owner-only record of every chat-creation attempt on one chat (openspec
 * `chat-start-location`, design D8/D9). `attempts` holds one entry per create
 * or resend; each entry carries the Workspace step's decisions and its own
 * `created_at`. Chat creation appends to the array, and the table is written
 * only by that path.
 *
 * `attempts` is `jsonb` with a CHECK that it is an array, not a typed column
 * per decision: the decision shape belongs to the permission evaluator, and a
 * later field must not need a migration. The row is one per chat, owner-scoped
 * by an owner policy plus a composite owner foreign key to `chats` — the same
 * shape as `worktree_leases`, whose chat key follows
 * `chats_id_owner_user_id_unique_idx` because a referenced key must be an
 * existing unique index. `FORCE ROW LEVEL SECURITY` is hand-appended in the
 * migration (Drizzle emits `ENABLE` only; `apps/api/src/db/AGENTS.md` P1).
 */
export const chatCreationRecords = pgTable(
  'chat_creation_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id').notNull(),
    /** One entry per attempt: its decisions and its own `created_at`. */
    attempts: jsonb('attempts')
      .$type<Array<ChatCreationAttempt>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One record per chat: a create and every resend append to the same row.
    uniqueIndex('chat_creation_records_owner_chat_uidx').on(
      t.ownerUserId,
      t.chatId,
    ),
    check(
      'chat_creation_records_attempts_check',
      sql`jsonb_typeof(${t.attempts}) = 'array'`,
    ),
    // Column order follows `chats_id_owner_user_id_unique_idx`, the unique key
    // this foreign key references; the owner match is the same.
    foreignKey({
      name: 'chat_creation_records_chat_owner_fk',
      columns: [t.chatId, t.ownerUserId],
      foreignColumns: [chats.id, chats.ownerUserId],
    }).onDelete('cascade'),
    pgPolicy('chat_creation_records_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type ChatCreationRecord = InferSelectModel<typeof chatCreationRecords>;
