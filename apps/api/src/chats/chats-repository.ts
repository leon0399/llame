/**
 * ChatsRepository — owner-scoped database access to the `chats`/`pins`
 * tables. Split from a single chats-repository.ts: MessagesRepository (the
 * `messages` table) and CompactionsRepository + findLiveWindow (the
 * `compactions` table) each moved to their own sibling file, re-exported
 * below so this module stays every existing consumer's one import path.
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
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  not,
  sql,
  type SQL,
} from 'drizzle-orm';
import { type Chat, chats, pins, type PinItemType } from '../db/schema';

import { type Db } from '../db/tenant-db.service';
export { type Db } from '../db/tenant-db.service';
import { isCompletedAssistantTurn } from './assistant-completion';
export { isCompletedAssistantTurn };
import {
  buildHybridSearchQuery,
  normalizeForSearch,
  RRF_DEFAULT_K,
  type HybridSearchResult,
} from '../search/core';
import { EMBED_INPUT_VERSION } from '../search/embed-input-version';

export {
  MessagesRepository,
  type ConversationMessageLookup,
} from './messages-repository';
export {
  CompactionsRepository,
  findLiveWindow,
} from './compactions-repository';

const DEFAULT_CHAT_VISIBILITY = 'private';

const CHAT_DOCUMENT_COLUMNS = {
  table: 'search_chat_documents',
  groupId: 'chat_id',
  id: 'id',
  fts: 'fts',
  normalized: 'normalized_content',
  content: 'content',
} as const;

const CHAT_PARENT_COLUMNS = {
  table: 'chats',
  id: 'id',
  title: 'title',
  recency: 'updated_at',
} as const;

const CHAT_VECTOR_COLUMNS = {
  embedding: 'embedding',
  embeddingModelKey: 'embedding_model_key',
  embeddedContentHash: 'embedded_content_hash',
  embedInputVersion: 'embed_input_version',
  contentHash: 'content_hash',
} as const;

const SNIPPET_MAX = 160;

type ChatUpdatePatch = {
  title?: string;
  visibility?: 'private' | 'public';
  projectId?: string | null;
  archived?: boolean;
};

type ChatOwnerFilter = {
  projectId?: string;
  pinned?: 'only' | 'with' | 'exclude';
  archived?: 'only' | 'with';
  limit?: number;
  excludeId?: string;
  titledOnly?: boolean;
};

/** Collapse whitespace and clip a matching message to a short search snippet. */
function truncateSnippet(text: string): string {
  const clean = text.replaceAll(/\s+/g, ' ').trim();
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
  private buildOwnerFilterConditions(
    ownerUserId: string,
    filter: ChatOwnerFilter,
  ): Array<SQL> {
    const conditions: Array<SQL> = [eq(chats.ownerUserId, ownerUserId)];

    if (filter.projectId !== undefined) {
      conditions.push(eq(chats.projectId, filter.projectId));
    }
    if (filter.excludeId !== undefined) {
      conditions.push(not(eq(chats.id, filter.excludeId)));
    }
    if (filter.titledOnly) {
      // Not merely NOT NULL. The chat PATCH DTO enforces `@MinLength(1)`, so a
      // title of `" "` is accepted and stored — non-null but carrying nothing.
      // Such a chat is untitled in substance, and admitting it would render a
      // blank entry and trip the digest part's stricter non-blank check, which
      // throws and aborts the whole send.
      conditions.push(isNotNull(chats.title), sql`btrim(${chats.title}) <> ''`);
    }

    // Archive filter: absent or 'with' besides default excluded; 'only' = archived.
    if (filter.archived === 'only') {
      conditions.push(isNotNull(chats.archivedAt));
    } else if (filter.archived !== 'with') {
      conditions.push(isNull(chats.archivedAt));
    }

    const pinCondition =
      filter.pinned === 'only'
        ? undefined
        : this.pinCondition(ownerUserId, filter.pinned);
    if (pinCondition !== undefined) {
      conditions.push(pinCondition);
    }

    return conditions;
  }

  async findByOwner(
    ownerUserId: string,
    filter: ChatOwnerFilter = {},
  ): Promise<Array<Chat>> {
    const conditions = this.buildOwnerFilterConditions(ownerUserId, filter);

    // Pinned-only lists follow owner pin rank; every other filter stays
    // updatedAt DESC (item-archive / add-pinned-items-reorder).
    if (filter.pinned === 'only') {
      const query = this.db
        .select(getTableColumns(chats))
        .from(chats)
        .innerJoin(
          pins,
          and(
            eq(pins.userId, ownerUserId),
            // SAFETY: 'chat' is a member of PinItemType.
            eq(pins.itemType, 'chat' as PinItemType),
            eq(pins.itemId, chats.id),
          ),
        )
        .where(and(...conditions))
        .orderBy(asc(pins.position), pins.itemId);
      return filter.limit === undefined ? query : query.limit(filter.limit);
    }

    const query = this.db
      .select()
      .from(chats)
      .where(and(...conditions))
      .orderBy(desc(chats.updatedAt));
    return filter.limit === undefined ? query : query.limit(filter.limit);
  }

  /**
   * Pin membership as an EXISTS/NOT EXISTS predicate over the caller's pins.
   * Returns `undefined` — no filtering at all — for `'with'` and for an absent
   * mode, which the list treats identically.
   *
   * A subquery preserves the `Chat[]` row shape for counts and exclusion reads.
   * The pinned-only list instead joins pins because it also orders by position.
   */
  private pinCondition(
    ownerUserId: string,
    pinned: 'only' | 'with' | 'exclude' | undefined,
  ) {
    if (pinned === undefined || pinned === 'with') {
      return undefined;
    }
    const pinSubquery = this.db
      .select({ itemId: pins.itemId })
      .from(pins)
      .where(
        and(
          eq(pins.userId, ownerUserId),
          // SAFETY: 'chat' is a member of PinItemType ('chat' | 'project');
          // eq()'s inferred column-comparison parameter widens the literal to
          // string in this position, so this pins it back to the enum type.
          eq(pins.itemType, 'chat' as PinItemType),
          eq(pins.itemId, chats.id),
        ),
      );
    return pinned === 'only' ? exists(pinSubquery) : not(exists(pinSubquery));
  }

  /** Exact eligible population for a rendered ratio; never shares a list cap. */
  async countByOwner(
    ownerUserId: string,
    filter: {
      pinned: 'only' | 'with' | 'exclude';
      excludeId: string;
      titledOnly: true;
    },
  ): Promise<number> {
    const conditions = [
      eq(chats.ownerUserId, ownerUserId),
      isNull(chats.archivedAt),
      not(eq(chats.id, filter.excludeId)),
      isNotNull(chats.title),
      // Same blank-title rule as the list, or the denominator counts chats the
      // list will never show.
      sql`btrim(${chats.title}) <> ''`,
    ];
    const pinCondition = this.pinCondition(ownerUserId, filter.pinned);
    if (pinCondition !== undefined) {
      conditions.push(pinCondition);
    }
    const [result] = await this.db
      .select({ value: count() })
      .from(chats)
      .where(and(...conditions));
    return result?.value ?? 0;
  }

  /** First writer wins; the predicate prevents divergent baseline epochs. */
  async setRecencyDigestIfAbsent(
    chatId: string,
    ownerUserId: string,
    baseline: Chat['recencyDigestBaseline'],
    told: Chat['recencyDigestTold'],
  ): Promise<Chat | undefined> {
    const [updated] = await this.db
      .update(chats)
      .set({ recencyDigestBaseline: baseline, recencyDigestTold: told })
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.ownerUserId, ownerUserId),
          isNull(chats.recencyDigestBaseline),
        ),
      )
      .returning();
    return updated;
  }

  /** Compaction starts a fresh epoch; unlike initialization it replaces both fields. */
  async setRecencyDigest(options: {
    chatId: string;
    ownerUserId: string;
    baseline: NonNullable<Chat['recencyDigestBaseline']>;
    told: NonNullable<Chat['recencyDigestTold']>;
    rebakedFrom: string;
  }): Promise<void> {
    const { chatId, ownerUserId, baseline, told, rebakedFrom } = options;
    await this.db
      .update(chats)
      .set({
        recencyDigestBaseline: baseline,
        recencyDigestTold: told,
        recencyDigestRebakedFrom: rebakedFrom,
      })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)));
  }

  /** Pin membership for the accumulated told-set, never the capped rendering. */
  async findPinnedChatIds(
    ownerUserId: string,
    chatIds: ReadonlyArray<string>,
  ): Promise<Set<string>> {
    if (chatIds.length === 0) return new Set();
    const rows = await this.db
      .select({ itemId: pins.itemId })
      .from(pins)
      .where(
        and(
          eq(pins.userId, ownerUserId),
          // SAFETY: 'chat' is a member of PinItemType ('chat' | 'project');
          // eq()'s inferred column-comparison parameter widens the literal to
          // string in this position, so this pins it back to the enum type.
          eq(pins.itemType, 'chat' as PinItemType),
          inArray(pins.itemId, [...chatIds]),
        ),
      );
    return new Set(rows.map(({ itemId }) => itemId));
  }

  /** Advances bookkeeping only after its server-authored append is persisted. */
  async updateRecencyDigestTold(
    chatId: string,
    ownerUserId: string,
    told: NonNullable<Chat['recencyDigestTold']>,
  ): Promise<void> {
    await this.db
      .update(chats)
      .set({ recencyDigestTold: told })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)));
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
   * can match by content alone. The internal result also retains
   * `bestDocumentId` for canonical model shaping; public adapters must project
   * that field explicitly.
   *
   * MUST be called with a transaction-scoped `Db` (constructed inside a
   * `TenantDbService.runAs` callback) — `SET LOCAL statement_timeout` reverts at
   * transaction end only inside one. Two call sites, both already inside `runAs`:
   * `ChatsService.searchChats` (web chat search) and the `search_conversations`
   * tool, which calls this SAME method (tool-calling D7 — one search path).
   */
  private buildChatSearchQuery(
    ownerUserId: string,
    normalizedQuery: string,
    likePattern: string,
    limit: number,
    vectorParams?: { queryVector: ReadonlyArray<number>; modelKey: string },
  ) {
    return buildHybridSearchQuery({
      query: normalizedQuery,
      likePattern,
      document: CHAT_DOCUMENT_COLUMNS,
      parent: CHAT_PARENT_COLUMNS,
      scope: {
        document: sql`d.owner_user_id = ${ownerUserId}`,
        parent: sql`c.owner_user_id = ${ownerUserId}`,
      },
      vector: vectorParams
        ? {
            queryVector: vectorParams.queryVector,
            activeModelKey: vectorParams.modelKey,
            currentInputVersion: EMBED_INPUT_VERSION,
            columns: CHAT_VECTOR_COLUMNS,
            weight: 1,
            limit: 100,
          }
        : undefined,
      weights: { fts: 1, trgm: 0.35, title: 1 },
      limits: { fts: 100, trgm: 40, title: 50 },
      rrfK: RRF_DEFAULT_K,
      groupTopNWeights: [1, 0.25, 0.1],
      limit,
    });
  }

  private toHybridSearchResult(row: HybridSearchResult): HybridSearchResult {
    return {
      id: row.id,
      title: row.title,
      snippet:
        row.snippet === null || row.snippet === undefined
          ? null
          : truncateSnippet(row.snippet),
      updatedAt: row.updatedAt,
      bestDocumentId: row.bestDocumentId,
    };
  }

  async searchByOwner(
    ownerUserId: string,
    query: string,
    limit: number,
    vectorParams?: { queryVector: ReadonlyArray<number>; modelKey: string },
  ): Promise<Array<HybridSearchResult>> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }
    await this.db.execute(sql`SET LOCAL statement_timeout = 3000`);
    const normalizedQuery = normalizeForSearch(trimmed);
    const likePattern = `%${normalizedQuery.replaceAll(/[\\%_]/g, String.raw`\$&`)}%`;

    const search = this.buildChatSearchQuery(
      ownerUserId,
      normalizedQuery,
      likePattern,
      limit,
      vectorParams,
    );

    const rows = await this.db.execute<HybridSearchResult>(search);
    return [...rows].map((r) => this.toHybridSearchResult(r));
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
  /**
   * Archive guard (chat-project-archive): an archived resource rejects every
   * write except pure unarchive (archived: false, no other fields) or pure
   * re-archive (archived: true on already archived — idempotent no-op).
   * Mixed unarchive-and-edit is rejected; the caller must unarchive first.
   */
  private assertUpdateArchiveGuard(
    current: Chat,
    patch: ChatUpdatePatch,
  ): void {
    if (current.archivedAt === null) return;

    const hasContentFields =
      patch.title !== undefined ||
      patch.visibility !== undefined ||
      patch.projectId !== undefined;
    const isPureUnarchive = patch.archived === false && !hasContentFields;
    const isPureReArchive = patch.archived === true && !hasContentFields;

    if (!isPureUnarchive && !isPureReArchive) {
      assertNotArchived(current);
    }
  }

  private resolveUpdateFields(
    current: Chat,
    patch: ChatUpdatePatch,
  ): Partial<typeof chats.$inferInsert> {
    const fields: Partial<typeof chats.$inferInsert> = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.visibility !== undefined) fields.visibility = patch.visibility;
    if (patch.projectId !== undefined) fields.projectId = patch.projectId;
    if (patch.archived === true && current.archivedAt === null) {
      fields.archivedAt = new Date();
    } else if (patch.archived === false) {
      fields.archivedAt = null;
    }
    return fields;
  }

  async update(
    chatId: string,
    ownerUserId: string,
    patch: ChatUpdatePatch,
  ): Promise<Chat | undefined> {
    const current = await this.findById(chatId, ownerUserId);
    if (!current) return undefined;

    this.assertUpdateArchiveGuard(current, patch);

    const fields = this.resolveUpdateFields(current, patch);
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
  async touch(chatId: string, ownerUserId: string): Promise<Chat | undefined> {
    // RETURNING, so the caller gets the post-lock row from the statement that
    // takes the lock. A separate SELECT afterwards would be equivalent in
    // content but would hold the chat row for an extra round trip, and this
    // row is contended from both directions (see the lock-order note in
    // run-execution.service.ts#finishRun) — lengthening the critical section
    // is measurable on the single-flight paths that race for it.
    const [updated] = await this.db
      .update(chats)
      .set({ updatedAt: new Date() })
      .where(and(eq(chats.id, chatId), eq(chats.ownerUserId, ownerUserId)))
      .returning();
    return updated;
  }
}
