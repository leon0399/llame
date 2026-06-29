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
   * Update a chat's title, scoped to owner (defense-in-depth).
   * Returns undefined if not found or not owned by this user.
   */
  async updateTitle(
    chatId: string,
    ownerUserId: string,
    title: string,
  ): Promise<Chat | undefined> {
    const [updated] = await this.db
      .update(chats)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning();

    return updated;
  }
}

export class MessagesRepository {
  constructor(private readonly db: Db) {}

  /**
   * List messages for a chat, oldest-first (for context window ordering).
   * Caller must have already verified chat ownership (RLS + ChatsRepository.findById).
   */
  async findByChatId(chatId: string): Promise<Message[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt));
  }

  /** Append a message to a chat. */
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
