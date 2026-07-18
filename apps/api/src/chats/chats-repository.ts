/**
 * ChatsRepository and MessagesRepository — owner-scoped database access.
 *
 * Every query filters by ownerUserId / chatId as defense-in-depth.
 * RLS is the primary isolation guarantee; these filters are the seatbelt.
 *
 * The `db` parameter accepts a PostgresJsDatabase from drizzle-orm/postgres-js.
 * It is typed loosely here so it can be injected by NestJS DI or mocked in tests.
 */

import { assertNotArchived } from '../db/assert-not-archived';

import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  sql,
} from 'drizzle-orm';
import {
  type Chat,
  type Compaction,
  type Message,
  type MessageRole,
  chats,
  compactions,
  messages,
  pins,
  type PinItemType,
} from '../db/schema';

import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';
import {
  buildHybridSearchQuery,
  normalizeForSearch,
  RRF_DEFAULT_K,
} from '../search/core';

const DEFAULT_CHAT_VISIBILITY = 'private';

const SNIPPET_MAX = 160;

/** Collapse whitespace and clip a matching message to a short search snippet. */
function truncateSnippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > SNIPPET_MAX
    ? `${clean.slice(0, SNIPPET_MAX).trimEnd()}…`
    : clean;
}

export class ChatsRepository {
  constructor(private readonly db: Db) {}

  /**
   * List chats owned by a user, newest-first by updatedAt. Pin state lives in
   * the per-user `pins` table (rework-item-pinning) and no longer affects this
   * ordering — the client composes the "Pinned" group from GET /pins.
   * `filter.projectId` narrows to chats filed into that project — a
   * server-side WHERE (covered by chats_project_idx), never a client-side
   * pass over the full list.
   */
  async findByOwner(
    ownerUserId: string,
    filter: {
      projectId?: string;
      pinned?: 'only' | 'with' | 'exclude';
      archived?: 'only' | 'with';
    } = {},
  ): Promise<Chat[]> {
    const conditions = [eq(chats.ownerUserId, ownerUserId)];

    if (filter.projectId !== undefined) {
      conditions.push(eq(chats.projectId, filter.projectId));
    }

    // Archive filter: absent or 'with' besides default excluded; 'only' = archived.
    if (filter.archived === 'only') {
      conditions.push(isNotNull(chats.archivedAt));
    } else if (filter.archived !== 'with') {
      conditions.push(isNull(chats.archivedAt));
    }

    // Pin filter via EXISTS/NOT EXISTS on the caller's pins (no JOIN, so the
    // Chat[] shape is preserved and last-message hydration is untouched).
    if (filter.pinned === 'only' || filter.pinned === 'exclude') {
      const pinSubquery = this.db
        .select({ itemId: pins.itemId })
        .from(pins)
        .where(
          and(
            eq(pins.userId, ownerUserId),
            eq(pins.itemType, 'chat' as PinItemType),
            eq(pins.itemId, chats.id),
          ),
        );
      conditions.push(
        filter.pinned === 'only'
          ? exists(pinSubquery)
          : not(exists(pinSubquery)),
      );
    }

    return this.db
      .select()
      .from(chats)
      .where(and(...conditions))
      .orderBy(desc(chats.updatedAt));
  }

  /**
   * User-facing chat search: the owner's chats matching by TITLE or by message
   * CONTENT (text parts of USER/ASSISTANT turns only — never system prompts or
   * tool internals), ranked by relevance, with a highlighted snippet from the
   * best-matching chunk (null for a title-only match).
   *
   * Phase 1 of #194 (#195): hybrid lexical retrieval over the derived
   * `search_chat_documents` projection — full-text (`simple` config) + trigram
   * (`word_similarity`) legs, plus a live title leg over `chats`, fused by
   * Reciprocal Rank Fusion via the shared search/core builder (mandatory scope
   * predicate = fail-closed tenant isolation). Ordering is PURE RELEVANCE with a
   * recency + id tie-break (replacing the MVP's recency-first order). RLS
   * (chats_owner / search_chat_documents_owner, FORCE) is the tenant guard; the in-CTE
   * `owner_user_id = ${ownerUserId}` seatbelt is defense-in-depth. Blank query →
   * [] (no full-table dump). `title` is nullable (#78) — a still-untitled chat
   * can match by content alone.
   *
   * MUST be called with a transaction-scoped `Db` (constructed inside a
   * `TenantDbService.runAs` callback) — `SET LOCAL statement_timeout` reverts at
   * transaction end only inside one. Two call sites, both already inside `runAs`:
   * `ChatsService.searchChats` (web chat search) and the `search_conversations`
   * tool, which calls this SAME method (tool-calling D7 — one search path).
   */
  async searchByOwner(
    ownerUserId: string,
    query: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      title: string | null;
      snippet: string | null;
      updatedAt: Date;
    }>
  > {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }
    await this.db.execute(sql`SET LOCAL statement_timeout = 3000`);
    // Normalize the query the SAME way the corpus was normalized (lowercase, NFKC,
    // whitespace-collapse) BEFORE it reaches the trigram leg: `word_similarity` is
    // case-sensitive, and `normalized_content` is always lowercased, so a raw-cased
    // query would score near zero on the fuzzy leg. FTS ('simple') lowercases
    // internally, so this is a no-op there. The LIKE pattern is escaped from the
    // normalized form for the trigram leg's substring match.
    const normalizedQuery = normalizeForSearch(trimmed);
    const likePattern = `%${normalizedQuery.replace(/[\\%_]/g, '\\$&')}%`;

    const search = buildHybridSearchQuery({
      query: normalizedQuery,
      likePattern,
      document: {
        table: 'search_chat_documents',
        groupId: 'chat_id',
        id: 'id',
        fts: 'fts',
        normalized: 'normalized_content',
        content: 'content',
      },
      parent: {
        table: 'chats',
        id: 'id',
        title: 'title',
        recency: 'updated_at',
      },
      scope: {
        document: sql`d.owner_user_id = ${ownerUserId}`,
        parent: sql`c.owner_user_id = ${ownerUserId}`,
      },
      weights: { fts: 1, trgm: 0.35, title: 1 },
      limits: { fts: 100, trgm: 40, title: 50 },
      rrfK: RRF_DEFAULT_K,
      groupTopNWeights: [1, 0.25, 0.1],
      limit,
    });

    const rows = await this.db.execute<{
      id: string;
      title: string | null;
      snippet: string | null;
      updatedAt: Date;
    }>(search);
    return [...rows].map((r) => ({
      id: r.id,
      title: r.title,
      snippet:
        r.snippet === null || r.snippet === undefined
          ? null
          : truncateSnippet(r.snippet),
      updatedAt: r.updatedAt,
    }));
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

  /**
   * Find a PUBLIC chat by id, with no owner scoping — for the public share view
   * (run under `runAsPublic`). The `visibility = 'public'` predicate is a
   * seatbelt on top of the `chats_public_read` RLS policy; a private/absent id
   * returns undefined (→ 404, no existence oracle).
   */
  async findPublicById(chatId: string): Promise<Chat | undefined> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.visibility, 'public')))
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
   * Only provided fields are changed; updatedAt is bumped for CONTENT changes
   * (title) but NOT for a pin toggle or filing move (metadata — must not
   * reorder by recency). `projectId: null` unfiles the chat; `projectId`
   * absent leaves the current filing unchanged. A foreign/nonexistent
   * projectId is rejected by the `chats_owner` RLS WITH CHECK (projects-
   * foundation) — the caller maps that denial to a clean 4xx, not here.
   * Returns undefined if not found or not owned by this user.
   */
  async update(
    chatId: string,
    ownerUserId: string,
    patch: {
      title?: string;
      visibility?: 'private' | 'public';
      projectId?: string | null;
      archived?: boolean;
    },
  ): Promise<Chat | undefined> {
    const current = await this.findById(chatId, ownerUserId);
    if (!current) return undefined;

    // Archive guard (chat-project-archive): an archived resource rejects every
    // write except pure unarchive (archived: false, no other fields) or pure
    // re-archive (archived: true on already archived — idempotent no-op).
    // Mixed unarchive-and-edit is rejected; the caller must unarchive first.
    const hasContentFields =
      patch.title !== undefined ||
      patch.visibility !== undefined ||
      patch.projectId !== undefined;

    if (current.archivedAt !== null) {
      const isPureUnarchive = patch.archived === false && !hasContentFields;
      const isPureReArchive = patch.archived === true && !hasContentFields;

      if (!isPureUnarchive && !isPureReArchive) {
        assertNotArchived(current);
      }
    }

    const fields = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.visibility !== undefined
        ? { visibility: patch.visibility }
        : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      ...(patch.archived === true && current.archivedAt === null
        ? { archivedAt: new Date() }
        : patch.archived === false
          ? { archivedAt: null }
          : {}),
    };

    // Nothing to change: don't issue a no-op write (which would needlessly bump
    // updatedAt). Return the current row instead — still owner-scoped, so the caller
    // gets the chat on a match and undefined (→ 404) when it's absent / not owned.
    if (Object.keys(fields).length === 0) {
      return current;
    }

    // Bump updatedAt only for CONTENT changes (title) — visibility, filing, and
    // archive are metadata and must not reorder the chat by recency.
    const contentChanged = patch.title !== undefined;

    const [updated] = await this.db
      .update(chats)
      .set(contentChanged ? { ...fields, updatedAt: new Date() } : fields)
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning();

    return updated;
  }

  /**
   * Delete a chat, scoped to owner (defense-in-depth on top of RLS). Returns
   * true iff a row was removed → false maps to 404. The FK cascade removes the
   * whole tree (messages, compactions, runs → run_events) in one
   * statement. A cross-tenant/absent id matches 0 rows (RLS + the owner
   * predicate), so the chat survives — never a silent cross-tenant delete.
   */
  async deleteById(chatId: string, ownerUserId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(chats)
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning({ id: chats.id });
    return deleted.length > 0;
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
   * Bulk-insert pre-built message rows (each with a caller-assigned `id`, so
   * `inReplyTo` can be remapped up front — no per-row RETURNING round-trip
   * needed to learn a new id before the next row references it).
   *
   * Chunked into multi-row INSERTs (not one row per statement, not one
   * INSERT for the whole batch): a single statement keeps `seq` identity
   * assignment in input order (needed for conversation order), while
   * chunking keeps any one statement's parameter count well under Postgres's
   * limit for arbitrarily large batches (a fork copies a conversation of any
   * length, #143 — no upper bound). Chunks are awaited in order, not via
   * `Promise.all`, so cross-chunk `seq` order is preserved too.
   */
  async createMany(
    rows: {
      id: string;
      chatId: string;
      role: MessageRole;
      senderUserId: string | null;
      parts: unknown[];
      attachments: unknown[];
      inReplyTo: string | null;
    }[],
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
  ): Promise<Message[]> {
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

  /**
   * Record a compaction only when no peer already owns the same chat/cutoff.
   * Used by transition compaction after its model call, where duplicate job
   * delivery may legitimately race on the unique cutoff.
   */
  async createIfCutoffAbsent(input: {
    chatId: string;
    uptoSeq: number;
    parentId?: string | null;
    summary: string;
    usage?: unknown;
  }): Promise<Compaction | undefined> {
    const [created] = await this.db
      .insert(compactions)
      .values({
        chatId: input.chatId,
        uptoSeq: input.uptoSeq,
        parentId: input.parentId ?? null,
        summary: input.summary,
        usage: input.usage,
      })
      .onConflictDoNothing({
        target: [compactions.chatId, compactions.uptoSeq],
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
 * Parameter is structural (`usage` only) so pure callers holding a
 * ContextBuilder StoredMessage share the exact same semantics as Message.
 */
export function isCompletedAssistantTurn(message: {
  usage?: unknown;
}): boolean {
  const usage = message.usage;
  if (typeof usage !== 'object' || usage === null || !('status' in usage)) {
    return true;
  }

  return (usage as { status?: unknown }).status === 'completed';
}
