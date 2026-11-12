import { InferSelectModel, sql } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  json,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
import { type PermissionMode } from '../../tools/permissions/permission-mode';
import { chats } from './chats';

/** Who produced a pending item. */
export type ChatDeliveryProducer = 'owner' | 'job';

/** How a pending item reaches the Chat; sends accept only owner modes. */
export const chatDeliveryModes = [
  'steer',
  'interrupt',
  'queue',
  'notice',
] as const;

export type ChatDeliveryMode = (typeof chatDeliveryModes)[number];

export const chatDeliveryStates = [
  'pending',
  'delivered',
  'withdrawn',
] as const;

export type ChatDeliveryState = (typeof chatDeliveryStates)[number];

/** The send settings an item keeps until it becomes a Run (accept-time values). */
export type ChatDeliverySettings = {
  modelId: string;
  effort?: string;
  permissionMode: PermissionMode;
};

/**
 * One message that arrived while its Chat had a live Run (run-steering D1).
 * `id` is the client message id, so it is also the id of the user message that
 * a promotion stores. `parts` are the sanitized parts with every file part
 * already resolved to its owner media, as the send stores them. `position`
 * orders the pending items; a later layer moves an item to the head by writing
 * a position below the minimum.
 *
 * NOTE: `.enableRLS()` only emits ENABLE. The migration ALSO issues
 * `FORCE ROW LEVEL SECURITY` (src/db/AGENTS.md P1); re-add FORCE if it is
 * regenerated.
 */
export const chatDeliveries = pgTable(
  'chat_deliveries',
  {
    id: uuid('id').primaryKey(),
    chatId: uuid('chat_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    producer: text('producer').notNull().$type<ChatDeliveryProducer>(),
    senderRef: text('sender_ref'),
    mode: text('mode').notNull().$type<ChatDeliveryMode>(),
    parts: json('parts').$type<Array<unknown>>().notNull(),
    settings: jsonb('settings').$type<ChatDeliverySettings>().notNull(),
    state: text('state')
      .notNull()
      .default('pending')
      .$type<ChatDeliveryState>(),
    position: bigint('position', { mode: 'number' })
      .notNull()
      .generatedByDefaultAsIdentity(),
    deliveredMessageId: uuid('delivered_message_id'),
    runId: uuid('run_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The owner must be the Chat's owner, as `runs_chat_id_user_id_fk` does.
    foreignKey({
      name: 'chat_deliveries_chat_id_owner_user_id_fk',
      columns: [t.chatId, t.ownerUserId],
      foreignColumns: [chats.id, chats.ownerUserId],
    }).onDelete('cascade'),
    // The pending order of one Chat.
    index('chat_deliveries_chat_pending_idx')
      .on(t.chatId, t.position)
      .where(sql`state = 'pending'`),
    // A job produces at most one notice, including after it was consumed.
    uniqueIndex('chat_deliveries_job_sender_unique')
      .on(t.senderRef)
      .where(sql`${t.producer} = 'job'`),
    pgPolicy('chat_deliveries_owner', {
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type ChatDelivery = InferSelectModel<typeof chatDeliveries>;
