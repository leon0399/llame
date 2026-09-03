import { InferSelectModel, sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from '../columns';
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

// pgvector's `vector` type (chat-search-embeddings, design D2) — drizzle-orm/
// pg-core has no native mapping either, same reasoning as tsvector above.
// Declared WITHOUT a dimension modifier deliberately: `vector(N)` would bake
// one model's dimensionality into the schema, making every model change a
// migration. Dimensions are validated in application code against the
// operator's declared catalog before insert, not by the column.
const vector = customType<{ data: string }>({
  dataType() {
    return 'vector';
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
    firstMessageAt: timestamptz('first_message_at').notNull(),
    lastMessageAt: timestamptz('last_message_at').notNull(),
    // Zero-based UTF-16 offsets in the first/last message's canonical visible
    // text. Nullable during the projection backfill; writers populate them in
    // the later locator-aware chunker layer.
    firstMessageTextOffset: integer('first_message_text_offset'),
    lastMessageTextOffsetExclusive: integer(
      'last_message_text_offset_exclusive',
    ),
    // Original-cased role-labelled chunk text — the snippet source.
    content: text('content').notNull(),
    // Deterministic role-free normalization (NFKC, whitespace-collapsed, lowercased;
    // accents/code/URLs preserved) — the match column for both FTS and trigram.
    normalizedContent: text('normalized_content').notNull(),
    // sha256 over (chunker_version + presentation content + normalized lexical
    // content + message range) — lets the reindex worker skip unchanged chunks and
    // (phase 2) guard stale embeddings.
    contentHash: text('content_hash').notNull(),
    // --- Embedding columns (chat-search-embeddings, design D2) ---------------
    // All five nullable: at most one vector per document, produced
    // asynchronously and independently of the lexical rebuild above. A column
    // form (not a separate table) so embeddings inherit this row's existing
    // owner RLS policy automatically — see the header comment and D2/D3.
    // Dimensionless (no `vector(N)`) — see the `vector` customType above.
    embedding: vector('embedding'),
    // The operator-declared internal model key that produced `embedding`
    // (`embeddingModels[].id` in llame.config.json) — NEVER the provider-side
    // model identifier (spec: "Provider-side identifiers SHALL NOT leak past
    // the backend adapter into stored rows").
    embeddingModelKey: text('embedding_model_key'),
    // Snapshot of `content_hash` at embed time (D7). The sole validity rule:
    // an embedding is current only while this matches the live `content_hash`
    // for the same model key and input version; a rebuild that changes
    // `content_hash` implicitly invalidates it.
    embeddedContentHash: text('embedded_content_hash'),
    // Bumped when the embedding INPUT shape changes independent of a model
    // change (e.g. whether role labels are embedded, D11's open question) —
    // a second axis alongside `embeddingModelKey`/`embeddedContentHash` that
    // the coverage predicate below must also compare.
    embedInputVersion: integer('embed_input_version'),
    // Terminal-failure tombstone (D16): set together with a NULL `embedding`
    // AND matching `embedding_model_key`/`embedded_content_hash`/
    // `embed_input_version` (the current model/content/version the attempt
    // was made against) in the same statement as a permanent (non-retryable)
    // embed failure. All four must be written together — the coverage
    // predicate's `IS DISTINCT FROM` checks are what stop re-attempting it,
    // and a failure write that stamps only this column while leaving the
    // other three NULL (or stale) leaves `needs_embedding` true forever,
    // silently defeating the tombstone. NULL means either "never attempted"
    // or "succeeded" — disambiguated by `embedding IS NOT NULL`.
    embeddingFailReason: text('embedding_fail_reason'),
    // STORED generated column — the FTS match target. Language-neutral `simple`
    // config (no stemming): correct for multilingual/mixed-language chats; the
    // trigram leg recovers shared stems, embeddings (phase 3) cover semantics.
    fts: tsvector('fts').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("normalized_content", ''))`,
    ),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
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
    // Partial index over the embedding-backlog sweep's STATIC branch
    // (chat-search-embeddings design D10/task 6.5, trap 5): "never
    // attempted" — embedding IS NULL AND embedding_fail_reason IS NULL — is
    // the ONE branch of the coverage predicate that binds no runtime
    // parameter, so it is the only one a static index can serve. The three
    // `IS DISTINCT FROM` branches (model/hash/version changed) compare
    // against bind parameters and stay unindexed by design — they only
    // produce rows after an operator-invoked model change or version bump,
    // which is exactly when the explicit `backfill` command runs a one-off
    // full scan. `llame_search_embedding_backlog` (the migration's
    // hand-appended function) reads ONLY this branch so it can use this
    // index; `llame_search_embedding_coverage` (all four branches, for
    // reporting) cannot and still full-scans by design.
    index('search_chat_documents_embedding_backlog_idx')
      .on(t.chatId, t.ownerUserId)
      .where(sql`embedding IS NULL AND embedding_fail_reason IS NULL`),
    // The Chat owner is the authorization boundary. Using the parent Chat here
    // lets an owner-scoped reindex repair a derived row whose duplicated owner
    // metadata was corrupted, while the WITH CHECK restores that metadata to
    // the authenticated owner. The explicit non-empty identity gate prevents
    // chats_public_read from making public projection rows visible through
    // runAsPublic.
    pgPolicy('search_chat_documents_owner', {
      for: 'all',
      using: sql`current_setting('app.current_user_id', true) <> '' AND chat_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true))`,
      withCheck: sql`current_setting('app.current_user_id', true) <> '' AND owner_user_id = current_setting('app.current_user_id', true) AND chat_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true))`,
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
    indexedAt: timestamptz('indexed_at'),
    // Chunker version the current projection was built with.
    chunkerVersion: integer('chunker_version').notNull(),
    // Number of current-version documents produced by the same rebuild. NULL
    // means this state row predates locator-aware projection preparation and is
    // therefore not ready for canonical reads; zero is a valid covered state
    // for a Chat with no eligible visible text.
    expectedDocumentCount: integer('expected_document_count'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('search_chat_state_owner_idx').on(t.ownerUserId),
    // The Chat owner is the authorization boundary. Using the parent Chat
    // lets an owner-scoped rebuild repair duplicated state ownership metadata;
    // the WITH CHECK still requires that metadata to be rewritten to the
    // authenticated owner. The non-empty identity gate keeps public Chat
    // sharing from making state rows visible through runAsPublic.
    pgPolicy('search_chat_state_owner', {
      for: 'all',
      using: sql`current_setting('app.current_user_id', true) <> '' AND chat_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true))`,
      withCheck: sql`current_setting('app.current_user_id', true) <> '' AND owner_user_id = current_setting('app.current_user_id', true) AND chat_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true))`,
    }),
  ],
).enableRLS();

export type SearchChatState = InferSelectModel<typeof searchChatState>;

// Embedding-model binding ledger (chat-search-embeddings, design D1). ONE row
// per operator-declared internal model key (`embeddingModels[].id` in
// llame.config.json), written on the FIRST persisted vector for that key —
// NOT on declaration, so a declared-but-never-used key can be corrected
// freely. It records the binding actually used to produce vectors: provider
// connection, provider-side model identifier, revision, dimensions, distance
// metric, optional asymmetric document/query prefixes, and batch size. A
// later declaration of the same key whose binding differs is rejected at
// boot (application-layer check, a later layer) — this table exists ONLY to
// make that check possible, turning silent embedding-space mixing under one
// key into a startup failure instead of corrupted ranking.
//
// `providerModelId` is server-only and MUST NOT leak past the backend
// adapter into stored document rows, application interfaces, logs, or any
// user- or model-visible surface (search-embeddings spec) — `embedding_model_key`
// on `search_chat_documents` carries only the internal key, never this value.
//
// Instance-global operator state: NO tenant column, and therefore NO RLS —
// FORCE RLS on a policy-less, owner-less table would make it unreadable by
// the non-BYPASSRLS request role every real request runs as. Deliberately NOT
// foreign-keyed from `search_chat_documents.embedding_model_key`: a document
// may still name a key whose ledger row has since been pruned (an operator
// may remove a declared model that still has vectors), and the binding check
// is an application-layer comparison against the declared catalog, not a
// referential constraint.
export const embeddingModelBindings = pgTable('embedding_model_bindings', {
  modelKey: text('model_key').primaryKey(),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  revision: text('revision'),
  dimensions: integer('dimensions').notNull(),
  // Cosine is the only distance metric this design produces (D12); the
  // column stays a per-key catalog field rather than a hardcoded assumption.
  distanceMetric: text('distance_metric').notNull().default('cosine'),
  documentPrefix: text('document_prefix'),
  queryPrefix: text('query_prefix'),
  batchSize: integer('batch_size'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export type EmbeddingModelBinding = InferSelectModel<
  typeof embeddingModelBindings
>;
