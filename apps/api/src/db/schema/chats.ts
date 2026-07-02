import { InferSelectModel } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';

// DB-enforced visibility values (not just a TS-level varchar union, which Postgres
// would not constrain).
export const chatVisibility = pgEnum('chat_visibility', ['private', 'public']);

// A conversation. `ownerUserId` is the tenant boundary for v0.1.
// (Org-owned chats add a nullable `orgId` in v0.3 — additive, not a retrofit.)
//
// NOTE: ownerUserId uses `text` (not `uuid`) because it references `users.id`
// which is a `text` column (NextAuth adapter convention). chats.id itself uses
// `uuid` since it is a new table with no legacy constraint.
export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // text — FK to users.id which is text (NextAuth convention)
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    titleManuallySetAt: timestamp('title_manually_set_at', {
      withTimezone: true,
    }),
    visibility: chatVisibility('visibility').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('chats_owner_updated_idx').on(t.ownerUserId, t.updatedAt),
    // RLS policy: text = text comparison (no ::uuid cast — owner_user_id is text).
    // NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
    // `FORCE ROW LEVEL SECURITY` on both tables, which Drizzle cannot express here
    // (no force option in this version). FORCE is load-bearing for the single-role
    // self-hosted case — see migration 0004 and the relforcerowsecurity assertion in
    // chats-rls.integration.spec.ts. If you regenerate this migration, re-add FORCE.
    pgPolicy('chats_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type Chat = InferSelectModel<typeof chats>;

export const messageRole = pgEnum('message_role', [
  'user',
  'assistant',
  'system',
  'tool',
]);

// A durable conversation turn (AI SDK v6 UIMessage shape) with sender attribution.
//
// senderUserId is nullable: set for human turns; null for assistant/system/tool.
// Resolves to a CANONICAL user (SPEC §7.1, §19.2).
// text — FK to users.id which is text (NextAuth convention).
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    // Monotonic insertion-order key. `created_at` defaults to now() = the TRANSACTION
    // timestamp, so messages written in one transaction (e.g. a user turn + its
    // assistant reply) share an identical created_at and cannot be ordered by it
    // deterministically. `seq` gives a stable conversation order; queries and the
    // ContextBuilder order by it, not by created_at.
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    role: messageRole('role').notNull(),
    // nullable: set for human turns; null for assistant/system/tool.
    // onDelete: set null — deleting a user anonymizes their past messages rather
    // than blocking the delete or cascading away conversation history.
    senderUserId: text('sender_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    parts: jsonb('parts').$type<unknown[]>().notNull(), // AI SDK v6 UIMessage parts array
    attachments: jsonb('attachments')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    usage: jsonb('usage'),
    inReplyTo: uuid('in_reply_to').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('messages_chat_created_idx').on(t.chatId, t.createdAt),
    // Ordering index: history is read with ORDER BY (chat_id, seq).
    index('messages_chat_seq_idx').on(t.chatId, t.seq),
    uniqueIndex('messages_in_reply_to_unique_idx').on(t.inReplyTo),
    // RLS: access messages only when their chat is owned by the current user
    pgPolicy('messages_owner', {
      using: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type Message = InferSelectModel<typeof messages>;

// A context-compaction summary (#57) — a first-class row, not an opaque inline event,
// so long chats stay auditable and rewindable (Hermes-style lineage, SPEC §2.1).
//
// A compaction supersedes every message with seq <= uptoSeq; the context builder then
// assembles summary + messages after uptoSeq. `parentId` chains compactions: when a
// compacted chat compacts again, the new row points at the one it absorbed, so the
// full history remains reconstructable (messages are never deleted or mutated).
export const compactions = pgTable(
  'compactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    // Supersedes all messages with messages.seq <= upto_seq in this chat.
    uptoSeq: bigint('upto_seq', { mode: 'number' }).notNull(),
    // Lineage: the previous compaction this one absorbed (null for the first).
    parentId: uuid('parent_id').references((): AnyPgColumn => compactions.id, {
      onDelete: 'set null',
    }),
    // Model-facing summary text (objective, constraints, decisions, pending items).
    summary: text('summary').notNull(),
    // Telemetry of the summarization call (TurnTelemetry shape), like messages.usage.
    usage: jsonb('usage'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Read path: latest compaction per chat (ORDER BY upto_seq DESC LIMIT 1).
    uniqueIndex('compactions_chat_upto_seq_idx').on(t.chatId, t.uptoSeq),
    uniqueIndex('compactions_id_chat_id_unique_idx').on(t.id, t.chatId),
    foreignKey({
      name: 'compactions_parent_id_chat_id_fk',
      columns: [t.parentId, t.chatId],
      foreignColumns: [t.id, t.chatId],
    }),
    // RLS: same shape as messages_owner. The migration ALSO issues
    // FORCE ROW LEVEL SECURITY (Drizzle can't express it) — see migration 0009
    // and the relforcerowsecurity assertion in chats-rls.integration.spec.ts.
    pgPolicy('compactions_owner', {
      using: sql`chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      )`,
    }),
  ],
).enableRLS();

export type Compaction = InferSelectModel<typeof compactions>;

// Re-export enum type for use in repository / service layer
export type MessageRole = (typeof messageRole.enumValues)[number];
