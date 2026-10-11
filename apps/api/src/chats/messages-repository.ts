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
  isNotNull,
  lt,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { countAbsorbedMessages } from './absorbed-message-count';
import { type Message, type MessageRole, chats, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  insertWithChatSequence,
  type MessageInsertWithoutSequence,
} from './message-sequence';
import {
  findConversationMessage,
  type ConversationMessageLookup,
} from './conversation-message-lookup';
import { type ContextItemPart } from './context-item';

/** A checkpoint row; the repository guarantees its boundary is present. */
export type CheckpointMessage = Message & { absorbedThroughSeq: number };

function isCheckpointMessage(row: Message): row is CheckpointMessage {
  return row.absorbedThroughSeq !== null;
}

/**
 * Hides an assistant reply whose Run is still in flight. The row exists from
 * the first model request so its in-Run context items survive a failed Run,
 * but owner-facing reads (history, forks, shares, previews) never show it
 * until a terminal writer finalizes it. Only assistant rows carry `running`,
 * so the predicate applies to every role.
 */
const notRunningReply = sql`(${messages.usage} ->> 'status') is distinct from 'running'`;

/**
 * An assistant reply a writer may still replace. Atomic guard against a retry
 * race: two overlapping retries of the same aborted/error turn can both pass
 * the app-level isCompletedAssistantTurn check before either writes. Without
 * this, a stale callback could overwrite (or revert to aborted) a reply
 * another retry already marked completed. Re-checking status in the WHERE
 * means a row that became `completed` no longer matches, so the loser writes
 * nothing and the completed answer stays intact.
 *
 * EXACTLY isCompletedAssistantTurn's semantics — the two layers must never
 * disagree on what "completed" means. `->` (jsonb) vs `->>` (text)
 * distinguishes the cases:
 *   usage not an object / no 'status' key → `->` IS NULL   → immutable
 *   {status: 'completed'}                 → text match     → immutable
 *   {status: <anything else, incl. null>} → DISTINCT FROM  → replaceable
 */
export const replaceableReply = sql`(${messages.usage} -> 'status') is not null and (${messages.usage} ->> 'status') is distinct from 'completed'`;

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

  /**
   * The rows an owner fork copies: everything up to `anchorSeq` plus the
   * checkpoint rows stored after it whose absorbed boundary is still inside
   * the copied prefix, oldest-first. No anchor means the whole chat.
   */
  findForkSource(
    chatId: string,
    ownerUserId: string,
    anchorSeq: number | undefined,
  ): Promise<Array<Message>> {
    const predicates = [
      eq(messages.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];
    if (anchorSeq !== undefined) {
      predicates.push(
        sql`(${lte(messages.seq, anchorSeq)} or (${eq(messages.role, 'checkpoint')} and ${lte(messages.absorbedThroughSeq, anchorSeq)}))`,
      );
    }

    return this.windowedByPredicates(predicates);
  }

  /** Latest checkpoint boundary strictly before the triggering user sequence. */
  findActiveCheckpoint(
    chatId: string,
    ownerUserId: string,
    options: { beforeSeq: number },
  ): Promise<CheckpointMessage | undefined> {
    return this.findCheckpoint(
      chatId,
      ownerUserId,
      lt(messages.absorbedThroughSeq, options.beforeSeq),
    );
  }

  /** The owner-scoped checkpoint exactly at an absorbed-history boundary. */
  findCheckpointByBoundary(
    chatId: string,
    ownerUserId: string,
    absorbedThroughSeq: number,
  ): Promise<CheckpointMessage | undefined> {
    return this.findCheckpoint(
      chatId,
      ownerUserId,
      eq(messages.absorbedThroughSeq, absorbedThroughSeq),
    );
  }

  private async findCheckpoint(
    chatId: string,
    ownerUserId: string,
    boundary: SQL,
  ): Promise<CheckpointMessage | undefined> {
    const rows = await this.db
      .select()
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(chats.ownerUserId, ownerUserId),
          eq(messages.role, 'checkpoint'),
          boundary,
        ),
      )
      .orderBy(desc(messages.absorbedThroughSeq))
      .limit(1);

    return rows.map((r) => r.messages).find(isCheckpointMessage);
  }

  /**
   * Insert one summary-only checkpoint at the next Chat-local sequence. The
   * partial boundary index is the guard against a duplicate boundary; the
   * publisher's chat-row lock and boundary read decide who may insert.
   */
  createCheckpoint(input: {
    chatId: string;
    absorbedThroughSeq: number;
    part: ContextItemPart;
    usage?: unknown;
  }): Promise<Message> {
    return this.create({
      chatId: input.chatId,
      role: 'checkpoint',
      absorbedThroughSeq: input.absorbedThroughSeq,
      parts: [input.part],
      usage: input.usage,
    });
  }

  /**
   * Run `predicates` against the joined messages/chats query, windowed
   * oldest-first: unbounded ascending, or the most recent `limit` rows
   * (queried newest-first, then reversed back to ascending). Shared by
   * `findByChatId`, `findForkSource` and `listPublicByChatId`, so the
   * desc+limit+reverse-for-a-window pattern and the running-reply exclusion
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
      .where(and(...predicates, notRunningReply));

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
   * Returns undefined if not found, in a different chat, not owned by this
   * user, or a reply whose Run is still running.
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
          notRunningReply,
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
   * Latest message per owned chat (highest seq) — chat-list previews. A reply
   * still running is skipped, so the preview stays on the newest visible row.
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
          notRunningReply,
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
   * User and assistant rows each checkpoint absorbed, per requested
   * checkpoint; see `countAbsorbedMessages` in absorbed-message-count.ts.
   */
  countAbsorbedMessages(
    chatId: string,
    ownerUserId: string,
    checkpointIds: ReadonlyArray<string>,
  ): Promise<Map<string, number>> {
    return countAbsorbedMessages(this.db, chatId, ownerUserId, checkpointIds);
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
    absorbedThroughSeq?: number | null;
    parts: Array<unknown>;
    attachments?: Array<unknown>;
    usage?: unknown;
    inReplyTo?: string | null;
  }): Promise<Message> {
    const values: MessageInsertWithoutSequence = {
      chatId: input.chatId,
      role: input.role,
      senderUserId: input.senderUserId ?? null,
      absorbedThroughSeq: input.absorbedThroughSeq ?? null,
      parts: input.parts,
      attachments: input.attachments ?? [],
      usage: input.usage,
      inReplyTo: input.inReplyTo ?? null,
    };
    if (input.id !== undefined) values.id = input.id;

    const created = await insertWithChatSequence(
      this.db,
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
    return insertWithChatSequence(
      this.db,
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
    return insertWithChatSequence(
      this.db,
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

  /**
   * The model that produced the newest assistant reply before `beforeSeq`,
   * whatever that reply's status and whether or not a checkpoint absorbed
   * it. Replies that record no model are skipped.
   */
  async findLatestReplyModelIdBefore(
    chatId: string,
    ownerUserId: string,
    beforeSeq: number,
  ): Promise<string | undefined> {
    const modelId = sql<string>`(${messages.usage} ->> 'modelId')`;
    const [row] = await this.db
      .select({ modelId })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(chats.ownerUserId, ownerUserId),
          eq(messages.role, 'assistant'),
          lt(messages.seq, beforeSeq),
          isNotNull(modelId),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(1);

    return row?.modelId;
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
          replaceableReply,
        ),
      )
      .returning();

    return updated;
  }
}
