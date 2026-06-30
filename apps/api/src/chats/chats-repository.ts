/**
 * ChatsRepository and MessagesRepository — owner-scoped database access.
 *
 * Every query filters by ownerUserId / chatId as defense-in-depth.
 * RLS is the primary isolation guarantee; these filters are the seatbelt.
 *
 * The `db` parameter accepts a PostgresJsDatabase from drizzle-orm/postgres-js.
 * It is typed loosely here so it can be injected by NestJS DI or mocked in tests.
 */

import { and, asc, desc, eq, lte } from 'drizzle-orm';
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

// Single source of truth for new-chat defaults, shared by every create path (explicit
// POST /chats and the first-message upsert) so they can't silently drift apart.
const DEFAULT_CHAT_TITLE = 'New chat';
const DEFAULT_CHAT_VISIBILITY = 'private';

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
        title: input.title ?? DEFAULT_CHAT_TITLE,
        visibility: input.visibility ?? DEFAULT_CHAT_VISIBILITY,
      })
      .returning();

    return created;
  }

  /**
   * Create a chat with a client-supplied id, or do nothing if that id already exists.
   *
   * Powers the "first message creates the chat" flow (#86): the client supplies the id
   * (routing + idempotency only), the owner is always the session user. The `id` conflict
   * is detected on the physical PK index — independent of RLS visibility — so an id already
   * held by ANOTHER tenant conflicts and returns `undefined` (no row, no hijack) rather than
   * creating a second chat. On a genuine insert, the `chats_owner` policy's USING expression
   * — applied as the implicit WITH CHECK for this FOR ALL policy — requires owner_user_id =
   * current_setting('app.current_user_id'), so a chat can never be created for anyone but the
   * current tenant. Mirrors createUserMessageIfAbsent.
   *
   * Returns the created chat, or undefined when the id already exists (mine or another's —
   * the caller disambiguates with a re-query).
   */
  async createIfAbsent(input: {
    id: string;
    ownerUserId: string;
    title?: string;
  }): Promise<Chat | undefined> {
    const [created] = await this.db
      .insert(chats)
      .values({
        id: input.id,
        ownerUserId: input.ownerUserId,
        title: input.title ?? DEFAULT_CHAT_TITLE,
        visibility: DEFAULT_CHAT_VISIBILITY,
      })
      .onConflictDoNothing({ target: chats.id })
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
    const fields = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
    };

    // Nothing to change: don't issue a no-op write (which would needlessly bump
    // updatedAt). Return the current row instead — still owner-scoped, so the caller
    // gets the chat on a match and undefined (→ 404) when it's absent / not owned.
    if (Object.keys(fields).length === 0) {
      return this.findById(chatId, ownerUserId);
    }

    const [updated] = await this.db
      .update(chats)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning();

    return updated;
  }

  /**
   * Bump a chat's updatedAt to mark recent activity (e.g. a new message turn), so
   * findByOwner (ordered by updatedAt) floats active chats to the top. Owner-scoped.
   */
  async touch(chatId: string, ownerUserId: string): Promise<void> {
    await this.db
      .update(chats)
      .set({ updatedAt: new Date() })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)));
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
  async findByChatId(
    chatId: string,
    ownerUserId: string,
    options?: { maxSeq?: number; limit?: number },
  ): Promise<Message[]> {
    const predicates = [
      eq(messages.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];

    if (options?.maxSeq !== undefined) {
      predicates.push(lte(messages.seq, options.maxSeq));
    }

    const query = this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(...predicates));

    const rows =
      options?.limit === undefined
        ? await query.orderBy(asc(messages.seq))
        : await query.orderBy(desc(messages.seq)).limit(options.limit);

    const orderedRows =
      options?.limit === undefined ? rows : [...rows].reverse();

    return orderedRows.map((r) => r.messages);
  }

  /**
   * Find a user turn and its assistant reply, scoped to one owned chat.
   * Used for client-message-id idempotency before any new write or model call.
   */
  async findTurnState(
    chatId: string,
    ownerUserId: string,
    userMessageId: string,
  ): Promise<{
    userMessage?: Message;
    assistantMessage?: Message;
  }> {
    const [userMessage] = (
      await this.db
        .select()
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(
            eq(messages.id, userMessageId),
            eq(messages.chatId, chatId),
            eq(messages.role, 'user'),
            eq(chats.ownerUserId, ownerUserId),
          ),
        )
        .limit(1)
    ).map((r) => r.messages);

    const [assistantMessage] = (
      await this.db
        .select()
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(
            eq(messages.chatId, chatId),
            eq(messages.role, 'assistant'),
            eq(messages.inReplyTo, userMessageId),
            eq(chats.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(asc(messages.seq))
        .limit(1)
    ).map((r) => r.messages);

    return { userMessage, assistantMessage };
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
    id?: string;
    chatId: string;
    role: MessageRole;
    senderUserId?: string | null;
    parts: unknown[];
    attachments?: unknown[];
    usage?: unknown;
    inReplyTo?: string | null;
  }): Promise<Message> {
    const [created] = await this.db
      .insert(messages)
      .values({
        ...(input.id !== undefined ? { id: input.id } : {}),
        chatId: input.chatId,
        role: input.role,
        senderUserId: input.senderUserId ?? null,
        parts: input.parts,
        attachments: input.attachments ?? [],
        usage: input.usage,
        inReplyTo: input.inReplyTo ?? null,
      })
      .returning();

    return created;
  }

  async createUserMessageIfAbsent(input: {
    id: string;
    chatId: string;
    senderUserId: string;
    parts: unknown[];
    attachments?: unknown[];
  }): Promise<Message | undefined> {
    const [created] = await this.db
      .insert(messages)
      .values({
        id: input.id,
        chatId: input.chatId,
        role: 'user',
        senderUserId: input.senderUserId,
        parts: input.parts,
        attachments: input.attachments ?? [],
      })
      .onConflictDoNothing({ target: messages.id })
      .returning();

    return created;
  }

  async createAssistantReplyIfAbsent(input: {
    chatId: string;
    parts: unknown[];
    usage?: unknown;
    inReplyTo: string;
  }): Promise<Message | undefined> {
    const [created] = await this.db
      .insert(messages)
      .values({
        chatId: input.chatId,
        role: 'assistant',
        senderUserId: null,
        parts: input.parts,
        attachments: [],
        usage: input.usage,
        inReplyTo: input.inReplyTo,
      })
      .onConflictDoNothing({ target: messages.inReplyTo })
      .returning();

    return created;
  }
}
