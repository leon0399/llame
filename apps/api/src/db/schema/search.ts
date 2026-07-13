import { InferSelectModel, sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { chats } from './chats';

// Postgres `tsvector` — drizzle-orm/pg-core has no native tsvector type, so we
// declare a minimal custom type. It is only ever a STORED generated column
// (never written directly), so the data-type mapping is nominal.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Derived lexical search projection (#195, phase 1 of #194). A `search_chat_documents`
// row is one contextual multi-message CHUNK of a chat, produced by the deterministic
// versioned conversation chunker (src/search/chat) over the text parts of user/
// assistant turns ONLY — never system prompts, tool payloads, reasoning, or
// attachments (that exclusion is the episodic-vs-knowledge corpus boundary, spec-
// level). Canonical `chats`/`messages` remain the source of truth; this projection
// is fully rebuildable from them and is maintained by a synchronous inline rebuild
// at assistant-finalization (Tier 1) plus an async reindex queue (Tier-1 fallback,
// fork, and the cross-tenant discovery sweep).
//
// `owner_user_id` is DENORMALIZED from `chats.owner_user_id` (text — matches
// `users.id`, NextAuth convention) so the RLS policy and the hot query's in-CTE
// seatbelt filter directly on this column, with NO correlated subquery back into
// `chats` on every candidate row. `first/last_message_id` are informational
// pointers into a rebuildable index (NOT hard FKs to `messages`): a message edit/
// delete is reconciled by a full per-chat rebuild, and the `chats` FK cascade
// already governs the lifecycle.
//
// NOTE: `.enableRLS()` emits ENABLE only. The migration ALSO hand-appends
// `FORCE ROW LEVEL SECURITY` (Drizzle can't express it) — same as chats/0004,
// runs/0011, org-units/0018, pins/0023. There is intentionally NO public-read
// policy: a `visibility = 'public'` chat is readable via the sharing path, but its
// projection rows MUST NOT be searchable by any other identity (including the empty
// public identity). Re-add FORCE if this migration is regenerated.
export const searchChatDocuments = pgTable(
  'search_chat_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    // Position of this chunk within its chat, at this chunker version.
    chunkOrdinal: integer('chunk_ordinal').notNull(),
    // Algorithm version. A bump invalidates every chunk (the discovery sweep
    // rebuilds them); documents of different versions never mix in one live chat.
    chunkerVersion: integer('chunker_version').notNull(),
    // Covered message range (informational pointers, not FKs — see header).
    firstMessageId: uuid('first_message_id').notNull(),
    lastMessageId: uuid('last_message_id').notNull(),
    firstMessageAt: timestamp('first_message_at', {
      withTimezone: true,
    }).notNull(),
    lastMessageAt: timestamp('last_message_at', {
      withTimezone: true,
    }).notNull(),
    // Original-cased serialized chunk text — the snippet source.
    content: text('content').notNull(),
    // Deterministic normalization (NFKC, whitespace-collapsed, lowercased; accents/
    // code/URLs preserved) — the match column for both FTS and trigram.
    normalizedContent: text('normalized_content').notNull(),
    // sha256 over (chunker_version + normalized_content + message range) — lets the
    // reindex worker skip unchanged chunks and (phase 2) guard stale embeddings.
    contentHash: text('content_hash').notNull(),
    // STORED generated column — the FTS match target. Language-neutral `simple`
    // config (no stemming): correct for multilingual/mixed-language chats; the
    // trigram leg recovers shared stems, embeddings (phase 3) cover semantics.
    fts: tsvector('fts').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("normalized_content", ''))`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('search_chat_documents_chat_ordinal_version_unique').on(
      t.chatId,
      t.chunkOrdinal,
      t.chunkerVersion,
    ),
    // FTS candidate leg.
    index('search_chat_documents_fts_idx').using('gin', t.fts),
    // Trigram candidate leg (word_similarity `<%`) — same GIN index.
    index('search_chat_documents_trgm_idx').using(
      'gin',
      t.normalizedContent.op('gin_trgm_ops'),
    ),
    // Owner-scoped candidate lookups + reindex delete-by-chat.
    index('search_chat_documents_owner_chat_idx').on(t.ownerUserId, t.chatId),
    // Recency tie-break ordering.
    index('search_chat_documents_owner_recency_idx').on(
      t.ownerUserId,
      t.lastMessageAt.desc(),
    ),
    // Owner is the whole boundary: SELECT (search) and write (reindex worker under
    // runAs(owner)) are both owner-scoped. FOR ALL covers both; empty identity
    // (runAsPublic) matches nothing, so public reads never reach this table.
    pgPolicy('search_chat_documents_owner', {
      for: 'all',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type SearchChatDocument = InferSelectModel<typeof searchChatDocuments>;

// Per-chat projection state (#195). One row per indexed chat records what the
// projection currently reflects, so the discovery sweep can find stale chats with a
// cheap timestamp/version comparison instead of deriving freshness from
// `search_chat_documents` (a chat whose content yields ZERO chunks — all-excluded parts
// — would otherwise look permanently un-indexed). `indexed_at` is set at rebuild to
// the chat's newest message time (fallback: the chat's own timestamp when it has no
// messages); the discovery sweep flags a chat whose newest message is later than
// `indexed_at`, or whose `chunker_version` is stale, or that has no state row.
//
// NOTE: `.enableRLS()` emits ENABLE only; the migration hand-appends FORCE (see
// searchChatDocuments). No public-read policy.
export const searchChatState = pgTable(
  'search_chat_state',
  {
    chatId: uuid('chat_id')
      .primaryKey()
      .references(() => chats.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Newest message time reflected by the current projection (null = never built).
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    // Chunker version the current projection was built with.
    chunkerVersion: integer('chunker_version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('search_chat_state_owner_idx').on(t.ownerUserId),
    pgPolicy('search_chat_state_owner', {
      for: 'all',
      using: sql`owner_user_id = current_setting('app.current_user_id', true)`,
      withCheck: sql`owner_user_id = current_setting('app.current_user_id', true)`,
    }),
  ],
).enableRLS();

export type SearchChatState = InferSelectModel<typeof searchChatState>;
