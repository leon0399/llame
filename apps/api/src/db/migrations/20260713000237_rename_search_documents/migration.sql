-- Hand-authored, NON-DESTRUCTIVE rename of the chat-search projection table
-- `search_documents` → `search_chat_documents` (chat-search-platform D1 naming
-- decision — a generic `search_documents` read as a universal store; the
-- convention is `search_<corpus>_*`, per-corpus tables). This post-dates the
-- original create migration (`20260712055209_search_projection`), which already
-- shipped the table under the old name to existing databases, so the rename is a
-- forward `ALTER TABLE ... RENAME` (+ every dependent index/constraint/policy)
-- that preserves all rows — NOT a drop/recreate. The create migration
-- (`20260712055209_search_projection`) is left UNCHANGED (it still `CREATE TABLE
-- "search_documents"`), so this rename runs on EVERY database, fresh or existing —
-- it is not a no-op on a fresh DB. Do NOT "clean up" by regenerating the create
-- migration to the final name: that would make this rename target a nonexistent
-- table and break fresh installs. Drizzle can't emit a table rename
-- non-interactively, so this is hand-written (AGENTS.md Gotchas exception).
-- `search_chat_state` keeps its name; the `llame_search_stale_chats` function
-- reads `search_chat_state`/`chats`/`messages` (never this table) and is unchanged.
ALTER TABLE "search_documents" RENAME TO "search_chat_documents";--> statement-breakpoint
ALTER INDEX "search_documents_chat_ordinal_version_unique" RENAME TO "search_chat_documents_chat_ordinal_version_unique";--> statement-breakpoint
ALTER INDEX "search_documents_fts_idx" RENAME TO "search_chat_documents_fts_idx";--> statement-breakpoint
ALTER INDEX "search_documents_trgm_idx" RENAME TO "search_chat_documents_trgm_idx";--> statement-breakpoint
ALTER INDEX "search_documents_owner_chat_idx" RENAME TO "search_chat_documents_owner_chat_idx";--> statement-breakpoint
ALTER INDEX "search_documents_owner_recency_idx" RENAME TO "search_chat_documents_owner_recency_idx";--> statement-breakpoint
ALTER TABLE "search_chat_documents" RENAME CONSTRAINT "search_documents_pkey" TO "search_chat_documents_pkey";--> statement-breakpoint
ALTER TABLE "search_chat_documents" RENAME CONSTRAINT "search_documents_owner_user_id_users_id_fk" TO "search_chat_documents_owner_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "search_chat_documents" RENAME CONSTRAINT "search_documents_chat_id_chats_id_fk" TO "search_chat_documents_chat_id_chats_id_fk";--> statement-breakpoint
ALTER POLICY "search_documents_owner" ON "search_chat_documents" RENAME TO "search_chat_documents_owner";
