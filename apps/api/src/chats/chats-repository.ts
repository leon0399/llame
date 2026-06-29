/**
 * ChatsRepository and MessagesRepository — owner-scoped database access.
 *
 * Every query filters by ownerUserId / chatId as defense-in-depth.
 * RLS is the primary isolation guarantee; these filters are the seatbelt.
 *
 * The `db` parameter accepts a PostgresJsDatabase from drizzle-orm/postgres-js.
 * It is typed loosely here so it can be injected by NestJS DI or mocked in tests.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import {
  type Chat,
  type Message,
  type MessageRole,
  chats,
  messages,
} from '../db/schema';

export type Db = PostgresJsDatabase<typeof schema>;

export class ChatsRepository {
  constructor(private readonly db: Db) {}

  /** List chats owned by a user, newest-first by updatedAt. */
  async findByOwner(ownerUserId: string): Promise<Chat[]> {
    return this.db
      .select()
      .from(chats)
      .where(eq(chats.ownerUserId, ownerUserId))
      .orderBy(desc(chats.updatedAt));
  }

  /**
   * Find a single chat by id, requiring ownership match (defense-in-depth).
   * Returns undefined if not found or not owned by this user.
   */
  async findById(
    chatId: string,
    ownerUserId: string,
  ): Promise<Chat | undefined> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .limit(1);

    return rows[0];
  }

  /** Create a new chat owned by a user. */
  async create(input: {
    ownerUserId: string;
    title?: string;
    visibility?: 'private' | 'public';
  }): Promise<Chat> {
    const [created] = await this.db
      .insert(chats)
      .values({
        ownerUserId: input.ownerUserId,
        title: input.title ?? 'New chat',
        visibility: input.visibility ?? 'private',
      })
      .returning();

    return created;
  }

  /**
   * Apply a partial update to a chat, scoped to owner (defense-in-depth).
   * Only provided fields are changed; updatedAt is always bumped.
   * Returns undefined if not found or not owned by this user.
   */
  async update(
    chatId: string,
    ownerUserId: string,
    patch: { title?: string },
  ): Promise<Chat | undefined> {
    const [updated] = await this.db
      .update(chats)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning();

    return updated;
  }
}

export class MessagesRepository {
  constructor(private readonly db: Db) {}

  /**
   * List a chat's messages oldest-first, ordered by `seq` (the monotonic
   * insertion key — created_at ties for same-transaction writes).
   *
   * Owner-scoped as defense-in-depth: the inner join requires the chat to be owned
   * by `ownerUserId`, so a caller that forgets the RLS-scoped transaction still
   * cannot read another tenant's messages. RLS remains the primary guarantee.
   */
  async findByChatId(chatId: string, ownerUserId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(eq(messages.chatId, chatId), eq(chats.ownerUserId, ownerUserId)),
      )
      .orderBy(asc(messages.seq));

    return rows.map((r) => r.messages);
  }

  /**
   * Append a message to a chat.
   *
   * Write ownership is enforced by RLS: the `messages_owner` policy's check rejects
   * an insert whose `chat_id` is not owned by the current `app.current_user_id`, and
   * the `chat_id` FK guarantees the chat exists. (No app-layer owner pre-check here —
   * it would be a redundant round-trip; the RLS WITH CHECK is atomic.)
   */
  async create(input: {
    chatId: string;
    role: MessageRole;
    senderUserId?: string | null;
    parts: unknown[];
    attachments?: unknown[];
  }): Promise<Message> {
    const [created] = await this.db
      .insert(messages)
      .values({
        chatId: input.chatId,
        role: input.role,
        senderUserId: input.senderUserId ?? null,
        parts: input.parts,
        attachments: input.attachments ?? [],
      })
      .returning();

    return created;
  }
}
