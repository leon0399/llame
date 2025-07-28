import { InferSelectModel } from 'drizzle-orm';
import { timestamp, pgTable, text, jsonb } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { v7 } from 'uuid';

export const chats = pgTable('chats', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  lastMessageAt: timestamp('last_message_at', { mode: 'date' }),
});

export type Chat = InferSelectModel<typeof chats>;

export type MessageRole = 'user' | 'assistant';

export const messages = pgTable('messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => v7()),
  chatId: text('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull(),
});

export type Message = InferSelectModel<typeof messages>;
