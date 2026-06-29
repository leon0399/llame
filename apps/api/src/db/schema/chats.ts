import { InferSelectModel } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';

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
    visibility: varchar('visibility', { enum: ['private', 'public'] })
      .notNull()
      .default('private'),
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

// A durable conversation turn (AI SDK v5 UIMessage shape) with sender attribution.
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
    role: messageRole('role').notNull(),
    // nullable: set for human turns; null for assistant/system/tool
    senderUserId: text('sender_user_id').references(() => users.id),
    parts: jsonb('parts').notNull(), // AI SDK v5 UIMessage parts array
    attachments: jsonb('attachments')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('messages_chat_created_idx').on(t.chatId, t.createdAt),
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

// Re-export enum type for use in repository / service layer
export type MessageRole = (typeof messageRole.enumValues)[number];
