/**
 * MessagesRepository — owner-scoped database access to the `messages` table
 * (split from chats-repository.ts: ChatsRepository owns `chats`/`pins`;
 * this repository owns `messages`).
 *
 * Every query filters by ownerUserId / chatId as defense-in-depth.
 * RLS is the primary isolation guarantee; these filters are the seatbelt.
 *
 * The `db` parameter accepts a PostgresJsDatabase from drizzle-orm/postgres-js.
 * It is typed loosely here so it can be injected by NestJS DI or mocked in tests.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  max,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { type Message, type MessageRole, chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import {
  findConversationMessage,
  type ConversationMessageLookup,
} from './conversation-message-lookup';
import { type ContextItemPart } from './context-item';

// Fixed application budget, not operator configuration. Current writers are
// bounded to assistant finalization/salvage after accepted-turn admission has
// rejected or expired an active Run; eight attempts leaves a defensive retry
// wave without permitting an unbounded transaction loop.
const MESSAGE_SEQUENCE_INSERT_ATTEMPTS = 8;
const MESSAGE_SEQUENCE_UNIQUE_INDEX = 'messages_chat_seq_unique_idx';

type MessageInsert = typeof messages.$inferInsert;
type MessageInsertWithoutSequence = Omit<MessageInsert, 'seq'>;

function isCauseChainLink(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isMessageSequenceUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    isCauseChainLink(current);
    current = current['cause']
  ) {
    const namesSequenceIndex =
      (isString(current['constraint_name']) &&
        current['constraint_name'] === MESSAGE_SEQUENCE_UNIQUE_INDEX) ||
      (isString(current['message']) &&
        current['message'].includes(MESSAGE_SEQUENCE_UNIQUE_INDEX));
    if (current['code'] === '23505' && namesSequenceIndex) {
      return true;
    }
  }
  return false;
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
  ): Promise<Array<Message>> {
    const predicates = [
      eq(messages.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];

    if (options?.maxSeq !== undefined) {
      predicates.push(lte(messages.seq, options.maxSeq));
    }

    // Exclusive lower bound for replay/planning: rows after a stored
    // checkpoint boundary. Callers filter checkpoint markers from ordinary
    // model history.
    if (options?.sinceSeq !== undefined) {
      predicates.push(gt(messages.seq, options.sinceSeq));
    }

    return this.windowedByPredicates(predicates, options);
  }
  /** Latest checkpoint boundary strictly before the triggering user sequence. */
  async findActiveCheckpoint(
    chatId: string,
    ownerUserId: string,
    options: { beforeSeq: number },
  ): Promise<Message | undefined> {
    const rows = await this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(chats.ownerUserId, ownerUserId),
          eq(messages.role, 'checkpoint'),
          lt(messages.absorbedThroughSeq, options.beforeSeq),
        ),
      )
      .orderBy(desc(messages.absorbedThroughSeq))
      .limit(1);

    return rows[0]?.messages;
  }

  /** The owner-scoped checkpoint exactly at an absorbed-history boundary. */
  async findCheckpointByBoundary(
    chatId: string,
    ownerUserId: string,
    absorbedThroughSeq: number,
  ): Promise<Message | undefined> {
    const rows = await this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(chats.ownerUserId, ownerUserId),
          eq(messages.role, 'checkpoint'),
          eq(messages.absorbedThroughSeq, absorbedThroughSeq),
        ),
      )
      .limit(1);

    return rows[0]?.messages;
  }

  /**
   * Insert one summary-only checkpoint at the next Chat-local sequence.
   * The partial boundary index makes publication idempotent; a concurrent
   * winner is read back when this insert becomes a no-op.
   */
  async createCheckpoint(input: {
    chatId: string;
    absorbedThroughSeq: number;
    part: ContextItemPart;
    usage?: unknown;
  }): Promise<Message> {
    const values: MessageInsertWithoutSequence = {
      chatId: input.chatId,
      role: 'checkpoint',
      absorbedThroughSeq: input.absorbedThroughSeq,
      senderUserId: null,
      parts: [input.part],
      attachments: [],
      usage: input.usage,
      inReplyTo: null,
    };
    const created = await this.insertWithChatSequence(
      values,
      async (tx, row) => {
        const [inserted] = await tx
          .insert(messages)
          .values(row)
          .onConflictDoNothing({
            target: [messages.chatId, messages.absorbedThroughSeq],
            where: sql`${messages.absorbedThroughSeq} IS NOT NULL`,
          })
          .returning();
        return inserted;
      },
    );
    if (created !== undefined) return created;

    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, input.chatId),
          eq(messages.role, 'checkpoint'),
          eq(messages.absorbedThroughSeq, input.absorbedThroughSeq),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (existing === undefined) {
      throw new Error('Checkpoint insert returned no row');
    }
    return existing;
  }

  /**
   * Run `predicates` against the joined messages/chats query, windowed
   * oldest-first: unbounded ascending, or the most recent `limit` rows
   * (queried newest-first, then reversed back to ascending). Shared by every
   * caller of this ordering/limiting shape — currently `findByChatId` and
   * `listPublicByChatId` — so the desc+limit+reverse-for-a-window pattern
   * can't drift between them.
   */
  private async windowedByPredicates(
    predicates: Array<SQL>,
    options?: { limit?: number },
  ): Promise<Array<Message>> {
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
   * Find a single message by id, scoped to a chat + owner (defense-in-depth).
   * Returns undefined if not found, in a different chat, or not owned by this user.
   */
  async findById(
    chatId: string,
    ownerUserId: string,
    messageId: string,
  ): Promise<Message | undefined> {
    const rows = await this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.chatId, chatId),
          eq(chats.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);

    return rows[0]?.messages;
  }

  /**
   * Resolve one immutable conversation source and its nearest eligible
   * neighbors; see `findConversationMessage` in conversation-message-lookup.ts.
   */
  findConversationMessage(
    chatId: string,
    ownerUserId: string,
    messageSeq: number,
  ): Promise<ConversationMessageLookup | undefined> {
    return findConversationMessage(this.db, chatId, ownerUserId, messageSeq);
  }

  /**
   * Bulk-insert pre-built message rows (each with a caller-assigned `id`, so
   * `inReplyTo` can be remapped up front — no per-row RETURNING round-trip
   * needed to learn a new id before the next row references it).
   *
   * Chunked into multi-row INSERTs (not one row per statement, not one
   * INSERT for the whole batch): callers provide the new Chat's explicit
   * one-based `seq` values in input order, while
   * chunking keeps any one statement's parameter count well under Postgres's
   * limit for arbitrarily large batches (a fork copies a conversation of any
   * length, #143 — no upper bound). Chunks are awaited in order, not via
   * `Promise.all`, so cross-chunk `seq` order is preserved too.
   *
   * `createdAt`/`usage` are the owner fork's verbatim copy of a source row's
   * time and price (complete-owner-forks D2). The shared fork passes neither,
   * and one call supplies both on every row or on none — so an omitted
   * `createdAt` lands as the column's `default` (now()), never as an explicit
   * NULL on a row that merely lacked one.
   */
  async createMany(
    rows: Array<{
      id: string;
      chatId: string;
      seq: number;
      role: MessageRole;
      senderUserId: string | null;
      absorbedThroughSeq?: number | null;
      parts: Array<unknown>;
      attachments: Array<unknown>;
      inReplyTo: string | null;
      createdAt?: Date;
      usage?: unknown;
    }>,
  ): Promise<void> {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await this.db.insert(messages).values(rows.slice(i, i + CHUNK_SIZE));
    }
  }

  /**
   * Latest message per owned chat (highest seq) — chat-list previews.
   *
   * Owner-scoped via the chats join, same defense-in-depth as findByChatId:
   * RLS is the primary guarantee, the ownerUserId predicate is the seatbelt.
   */
  async findLatestPerOwnedChat(ownerUserId: string): Promise<Array<Message>> {
    const rows = await this.db
      .selectDistinctOn([messages.chatId])
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(chats.ownerUserId, ownerUserId),
          inArray(messages.role, ['user', 'assistant']),
        ),
      )
      .orderBy(messages.chatId, desc(messages.seq));

    return rows.map((r) => r.messages);
  }

  /**
   * Earliest USER message per chat, for a bounded set of chats — the recency
   * digest's excerpt source.
   *
   * One query for the whole set rather than one per chat. The digest reads a
   * single message out of each candidate, so hydrating full histories would
   * fetch every row of a long or compacted chat to use its first — and the
   * `deltas` layer re-resolves these same capped views on every send, which
   * would turn a per-chat cost into a per-send one.
   *
   * `asc(seq)` is the insertion order the capability specifies, and the `user`
   * filter is in the predicate rather than applied afterwards: DISTINCT ON
   * keeps the first row per partition, so filtering later would discard the
   * chat entirely whenever its earliest message is not the owner's.
   *
   * Owner-scoped via the chats join, same defense-in-depth as findByChatId.
   */
  async findEarliestUserMessagePerChat(
    chatIds: ReadonlyArray<string>,
    ownerUserId: string,
  ): Promise<Array<Message>> {
    if (chatIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .selectDistinctOn([messages.chatId])
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(chats.ownerUserId, ownerUserId),
          inArray(messages.chatId, [...chatIds]),
          eq(messages.role, 'user'),
        ),
      )
      .orderBy(messages.chatId, asc(messages.seq));

    return rows.map((r) => r.messages);
  }

  /** Stored message count per chat for a bounded set, as one grouped query. */
  async countPerChat(
    chatIds: ReadonlyArray<string>,
    ownerUserId: string,
  ): Promise<Map<string, number>> {
    if (chatIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ chatId: messages.chatId, value: count() })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(chats.ownerUserId, ownerUserId),
          inArray(messages.chatId, [...chatIds]),
          ne(messages.role, 'checkpoint'),
        ),
      )
      .groupBy(messages.chatId);

    return new Map(rows.map(({ chatId, value }) => [chatId, value]));
  }

  /**
   * List a chat's messages with no owner scoping — for the public share view
   * (run under `runAsPublic`, where `messages_public_read` scopes to public
   * chats). The `chat_id` + `visibility = 'public'` join is a seatbelt so a
   * bug (or a future call-site/policy change) can't return OTHER public
   * chats' messages, or this chat's messages after it's gone private —
   * mirrors findPublicById's own re-assertion; RLS remains the primary
   * guarantee.
   *
   * Faithfulness is the product invariant here (same reasoning that removed
   * the owner fork's message cap): the conversation is never truncated.
   * Per-request cost on this unauthenticated, uncached (`no-store`) route is
   * bounded the same way the owner history API bounds it — cursor pagination
   * (`limit`/`maxSeq`), not a length cap. Mirrors findByChatId's exact
   * options shape and desc+limit+reverse-for-a-window pattern; omitting
   * `options` (the fork's read path) returns the WHOLE conversation
   * ascending, same as findByChatId's own unlimited path.
   */
  async listPublicByChatId(
    chatId: string,
    options?: { maxSeq?: number; limit?: number },
  ): Promise<Array<Message>> {
    const predicates = [
      eq(messages.chatId, chatId),
      eq(chats.visibility, 'public'),
      // Only the conversation is ever public — never a (future) system/tool
      // row. Enforced at the query too (not just the DTO), matching the
      // search path's guard, so a later tool-parts-persistence change can't
      // silently leak internals into a shared link.
      inArray(messages.role, ['user', 'assistant']),
    ];

    if (options?.maxSeq !== undefined) {
      predicates.push(lte(messages.seq, options.maxSeq));
    }

    return this.windowedByPredicates(predicates, options);
  }

  /**
   * Find a user turn and its assistant reply, scoped to one owned chat.
   * Used for client-message-id idempotency before any new write or model call.
   */
  /** The single message matching `predicates`, earliest first when more than one could match. */
  private async findOneMessage(
    predicates: Array<SQL>,
    options?: { orderBySeq?: boolean },
  ): Promise<Message | undefined> {
    const query = this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(...predicates));
    const rows = options?.orderBySeq
      ? await query.orderBy(asc(messages.seq)).limit(1)
      : await query.limit(1);
    return rows.map((r) => r.messages)[0];
  }

  async findTurnState(
    chatId: string,
    ownerUserId: string,
    userMessageId: string,
  ): Promise<{
    userMessage?: Message;
    assistantMessage?: Message;
  }> {
    const userMessage = await this.findOneMessage([
      eq(messages.id, userMessageId),
      eq(messages.chatId, chatId),
      eq(messages.role, 'user'),
      eq(chats.ownerUserId, ownerUserId),
    ]);
    const assistantMessage = await this.findOneMessage(
      [
        eq(messages.chatId, chatId),
        eq(messages.role, 'assistant'),
        eq(messages.inReplyTo, userMessageId),
        eq(chats.ownerUserId, ownerUserId),
      ],
      { orderBySeq: true },
    );

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
    parts: Array<unknown>;
    attachments?: Array<unknown>;
    usage?: unknown;
    inReplyTo?: string | null;
  }): Promise<Message> {
    const values: MessageInsertWithoutSequence = {
      chatId: input.chatId,
      role: input.role,
      senderUserId: input.senderUserId ?? null,
      parts: input.parts,
      attachments: input.attachments ?? [],
      usage: input.usage,
      inReplyTo: input.inReplyTo ?? null,
    };
    if (input.id !== undefined) values.id = input.id;

    const created = await this.insertWithChatSequence(
      values,
      async (tx, row) => {
        const [inserted] = await tx.insert(messages).values(row).returning();
        return inserted;
      },
    );
    if (!created) {
      throw new Error('Message insert returned no row');
    }
    return created;
  }

  async createUserMessageIfAbsent(input: {
    id: string;
    chatId: string;
    senderUserId: string;
    parts: Array<unknown>;
    attachments?: Array<unknown>;
  }): Promise<Message | undefined> {
    return this.insertWithChatSequence(
      {
        id: input.id,
        chatId: input.chatId,
        role: 'user',
        senderUserId: input.senderUserId,
        parts: input.parts,
        attachments: input.attachments ?? [],
      },
      async (tx, row) => {
        const [created] = await tx
          .insert(messages)
          .values(row)
          .onConflictDoNothing({ target: messages.id })
          .returning();
        return created;
      },
    );
  }

  async createAssistantReplyIfAbsent(input: {
    chatId: string;
    parts: Array<unknown>;
    usage?: unknown;
    inReplyTo: string;
  }): Promise<Message | undefined> {
    return this.insertWithChatSequence(
      {
        chatId: input.chatId,
        role: 'assistant',
        senderUserId: null,
        parts: input.parts,
        attachments: [],
        usage: input.usage,
        inReplyTo: input.inReplyTo,
      },
      async (tx, row) => {
        const [created] = await tx
          .insert(messages)
          .values(row)
          .onConflictDoNothing({ target: messages.inReplyTo })
          .returning();
        return created;
      },
    );
  }

  /** Replace a persisted user turn's parts within the owner-scoped transaction. */
  async updateUserMessageParts(input: {
    id: string;
    chatId: string;
    parts: Array<unknown>;
  }): Promise<Message | undefined> {
    const [updated] = await this.db
      .update(messages)
      .set({ parts: input.parts })
      .where(
        and(
          eq(messages.id, input.id),
          eq(messages.chatId, input.chatId),
          eq(messages.role, 'user'),
        ),
      )
      .returning();

    return updated;
  }

  private async insertWithChatSequence(
    values: MessageInsertWithoutSequence,
    insert: (tx: Db, row: MessageInsert) => Promise<Message | undefined>,
  ): Promise<Message | undefined> {
    let sequenceConflict: unknown;
    for (
      let attempt = 0;
      attempt < MESSAGE_SEQUENCE_INSERT_ATTEMPTS;
      attempt++
    ) {
      try {
        return await this.db.transaction(async (tx) => {
          const [current] = await tx
            .select({ value: max(messages.seq) })
            .from(messages)
            .where(eq(messages.chatId, values.chatId));
          const seq = (current?.value ?? 0) + 1;
          if (!Number.isSafeInteger(seq) || seq <= 0) {
            throw new Error(
              `Chat ${values.chatId} exhausted safe message sequence values`,
            );
          }
          return insert(tx, { ...values, seq });
        });
      } catch (error) {
        if (!isMessageSequenceUniqueViolation(error)) {
          throw error;
        }
        sequenceConflict = error;
      }
    }
    throw sequenceConflict;
  }

  async updateAssistantReply(input: {
    id: string;
    chatId: string;
    inReplyTo: string;
    parts: Array<unknown>;
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
          // EXACTLY isCompletedAssistantTurn's semantics — the two layers must
          // never disagree on what "completed" means. `->` (jsonb) vs `->>`
          // (text) distinguishes the cases:
          //   usage not an object / no 'status' key → `->` IS NULL   → immutable
          //   {status: 'completed'}                 → text match     → immutable
          //   {status: <anything else, incl. null>} → DISTINCT FROM  → retryable
          sql`(${messages.usage} -> 'status') is not null and (${messages.usage} ->> 'status') is distinct from 'completed'`,
        ),
      )
      .returning();

    return updated;
  }
}
