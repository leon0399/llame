/**
 * ChatsRepository and MessagesRepository — owner-scoped database access.
 *
 * Every query filters by ownerUserId / chatId as defense-in-depth.
 * RLS is the primary isolation guarantee; these filters are the seatbelt.
 *
 * The `db` parameter accepts a PostgresJsDatabase from drizzle-orm/postgres-js.
 * It is typed loosely here so it can be injected by NestJS DI or mocked in tests.
 */

import { and, asc, desc, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  type Chat,
  type Compaction,
  type Message,
  type MessageRole,
  chats,
  compactions,
  messages,
} from '../db/schema';

import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';

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

  /** Create a new chat owned by a user. Without a title it starts untitled (NULL, #78). */
  async create(input: {
    ownerUserId: string;
    title?: string;
    visibility?: 'private' | 'public';
  }): Promise<Chat> {
    const [created] = await this.db
      .insert(chats)
      .values({
        ownerUserId: input.ownerUserId,
        title: input.title ?? null,
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
        title: input.title ?? null,
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
    const fields = patch.title === undefined ? {} : { title: patch.title };

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
   * Persist a server-generated title (#78), but ONLY while the chat is still
   * untitled — the `title IS NULL` WHERE guard makes it atomic, so any title that
   * landed while generation ran (a user rename, or a concurrent generation) is
   * never clobbered. Owner-scoped like every write.
   * Returns the updated chat, or undefined when the guard (or scope) didn't match.
   */
  async setGeneratedTitle(
    chatId: string,
    ownerUserId: string,
    title: string,
  ): Promise<Chat | undefined> {
    const [updated] = await this.db
      .update(chats)
      .set({ title })
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.ownerUserId, ownerUserId),
          isNull(chats.title),
        ),
      )
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
    options?: { maxSeq?: number; sinceSeq?: number; limit?: number },
  ): Promise<Message[]> {
    const predicates = [
      eq(messages.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];

    if (options?.maxSeq !== undefined) {
      predicates.push(lte(messages.seq, options.maxSeq));
    }

    // Exclusive lower bound: messages AFTER a compaction's uptoSeq (#57) — the
    // superseded turns are represented by the summary, not read again.
    if (options?.sinceSeq !== undefined) {
      predicates.push(gt(messages.seq, options.sinceSeq));
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
   * Latest message per owned chat (highest seq) — chat-list previews.
   *
   * Owner-scoped via the chats join, same defense-in-depth as findByChatId:
   * RLS is the primary guarantee, the ownerUserId predicate is the seatbelt.
   */
  async findLatestPerOwnedChat(ownerUserId: string): Promise<Message[]> {
    const rows = await this.db
      .selectDistinctOn([messages.chatId])
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(eq(chats.ownerUserId, ownerUserId))
      .orderBy(messages.chatId, desc(messages.seq));

    return rows.map((r) => r.messages);
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

  async updateAssistantReply(input: {
    id: string;
    chatId: string;
    inReplyTo: string;
    parts: unknown[];
    usage?: unknown;
  }): Promise<Message | undefined> {
    const [updated] = await this.db
      .update(messages)
      .set({
        parts: input.parts,
        usage: input.usage,
      })
      .where(
        and(
          eq(messages.id, input.id),
          eq(messages.chatId, input.chatId),
          eq(messages.role, 'assistant'),
          eq(messages.inReplyTo, input.inReplyTo),
          // Atomic guard against a retry race: two overlapping retries of the same
          // aborted/error turn can both pass the app-level isCompletedAssistantTurn check
          // before either writes. Without this, a stale callback could overwrite (or revert
          // to aborted) a reply another retry already marked completed. Re-check status in
          // the WHERE so a row that became `completed` no longer matches → the loser updates
          // 0 rows and returns undefined, leaving the completed answer intact.
          sql`(${messages.usage} ->> 'status') is distinct from 'completed'`,
        ),
      )
      .returning();

    return updated;
  }
}

export class CompactionsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Latest compaction for a chat (highest uptoSeq), or undefined when the chat has
   * never compacted. Owner-scoped as defense-in-depth, mirroring MessagesRepository:
   * the join requires the chat to be owned by `ownerUserId`; RLS remains the primary
   * guarantee.
   */
  async findLatestByChatId(
    chatId: string,
    ownerUserId: string,
    options?: { beforeSeq?: number },
  ): Promise<Compaction | undefined> {
    const predicates = [
      eq(compactions.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];

    if (options?.beforeSeq !== undefined) {
      predicates.push(lt(compactions.uptoSeq, options.beforeSeq));
    }

    const rows = await this.db
      .select()
      .from(compactions)
      .innerJoin(chats, eq(compactions.chatId, chats.id))
      .where(and(...predicates))
      .orderBy(desc(compactions.uptoSeq))
      .limit(1);

    return rows.map((r) => r.compactions)[0];
  }

  /**
   * Record a compaction (#57). Write ownership is enforced by RLS: the
   * `compactions_owner` policy's implicit WITH CHECK rejects an insert whose
   * chat_id is not owned by the current app.current_user_id.
   */
  async create(input: {
    chatId: string;
    uptoSeq: number;
    parentId?: string | null;
    summary: string;
    usage?: unknown;
  }): Promise<Compaction> {
    const [created] = await this.db
      .insert(compactions)
      .values({
        chatId: input.chatId,
        uptoSeq: input.uptoSeq,
        parentId: input.parentId ?? null,
        summary: input.summary,
        usage: input.usage,
      })
      .returning();

    return created;
  }
}

/**
 * Load a chat's live context window (#57) in one place: the latest compaction
 * (optionally bounded to a turn) plus the messages after it. Shared by the chat
 * loop (bounded by the triggering turn's seq + message cap) and the compaction
 * service (unbounded) so the lineage read semantics cannot drift between them.
 */
export async function findLiveWindow(
  db: Db,
  chatId: string,
  ownerUserId: string,
  options?: { maxSeq?: number },
): Promise<{ compaction: Compaction | undefined; history: Message[] }> {
  const compaction = await new CompactionsRepository(db).findLatestByChatId(
    chatId,
    ownerUserId,
    options?.maxSeq !== undefined ? { beforeSeq: options.maxSeq } : undefined,
  );

  const history = await new MessagesRepository(db).findByChatId(
    chatId,
    ownerUserId,
    {
      ...(options?.maxSeq !== undefined ? { maxSeq: options.maxSeq } : {}),
      ...(compaction ? { sinceSeq: compaction.uptoSeq } : {}),
    },
  );

  return { compaction, history };
}

/**
 * A turn is complete iff its assistant message carries completed usage —
 * malformed/legacy usage counts as complete (never retryable by accident).
 */
export function isCompletedAssistantTurn(message: Message): boolean {
  const usage = message.usage;
  if (typeof usage !== 'object' || usage === null || !('status' in usage)) {
    return true;
  }

  return (usage as { status?: unknown }).status === 'completed';
}
