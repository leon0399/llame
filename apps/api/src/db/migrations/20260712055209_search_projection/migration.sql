-- Hand-appended (Drizzle can't express CREATE EXTENSION, FORCE ROW LEVEL
-- SECURITY, or CREATE FUNCTION — chat-search-platform #195; same exception
-- class as 0004/0011/0018/0019/0021/0023). `pg_trgm` is a TRUSTED contrib
-- extension (PG13+), so the non-superuser `app` role that owns the database
-- can create it — no image change, no superuser step. It MUST precede the
-- `search_documents_trgm_idx` (gin_trgm_ops) below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "search_chat_state" (
	"chat_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"indexed_at" timestamp with time zone,
	"chunker_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_chat_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"chunk_ordinal" integer NOT NULL,
	"chunker_version" integer NOT NULL,
	"first_message_id" uuid NOT NULL,
	"last_message_id" uuid NOT NULL,
	"first_message_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"content" text NOT NULL,
	"normalized_content" text NOT NULL,
	"content_hash" text NOT NULL,
	"fts" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("normalized_content", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_chat_state" ADD CONSTRAINT "search_chat_state_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chat_state" ADD CONSTRAINT "search_chat_state_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_chat_state_owner_idx" ON "search_chat_state" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_documents_chat_ordinal_version_unique" ON "search_documents" USING btree ("chat_id","chunk_ordinal","chunker_version");--> statement-breakpoint
CREATE INDEX "search_documents_fts_idx" ON "search_documents" USING gin ("fts");--> statement-breakpoint
CREATE INDEX "search_documents_trgm_idx" ON "search_documents" USING gin ("normalized_content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_documents_owner_chat_idx" ON "search_documents" USING btree ("owner_user_id","chat_id");--> statement-breakpoint
CREATE INDEX "search_documents_owner_recency_idx" ON "search_documents" USING btree ("owner_user_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "search_chat_state_owner" ON "search_chat_state" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true)) WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "search_documents_owner" ON "search_documents" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true)) WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
-- FORCE so the schema-owning `app` role is subject to the owner policy too —
-- ENABLE alone lets the table owner bypass RLS, which would silently lose tenant
-- isolation on a single-role self-hosted deployment. NO public-read policy: a
-- public chat's projection rows must never be searchable by another identity.
ALTER TABLE "search_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_chat_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Cross-tenant staleness discovery for the reindex sweep (#195, design D6).
-- Enumerating chats that need (re)indexing spans ALL tenants, which a plain
-- runAs identity cannot do under FORCE RLS — so this is SECURITY DEFINER and,
-- like `llame_role_on_unit_path` (0019), runs AS `app_rls` (BYPASSRLS is the
-- only thing that outranks FORCE; a plain SECURITY DEFINER owned by `app` would
-- still be caught by FORCE). It returns ONLY identifiers + timestamps, never
-- content — every message read stays inside a per-owner runAs in the worker.
-- `current_chunker_version` is passed by the caller (the source of truth is the
-- TS CHUNKER_VERSION), so a version bump re-flags every chat for rebuild.
-- `search_path` pinned against the SECURITY DEFINER search-path hijack.
--
-- Ownership is NOT reassigned here (same reason as 0019: `ALTER FUNCTION ...
-- OWNER TO app_rls` needs `app` to be a member of `app_rls`, which would also
-- grant SET ROLE app_rls / BYPASSRLS directly). The reassignment runs as the
-- `postgres` superuser via docker/postgres/rls-function-owner.sql
-- (`pnpm db:provision-rls`). Until then it is (harmlessly) owned by `app` and
-- does not bypass RLS, so the sweep sees only the caller's own chats.
CREATE FUNCTION llame_search_stale_chats(current_chunker_version integer, max_rows integer)
RETURNS TABLE (chat_id uuid, owner_user_id text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.owner_user_id, c.updated_at
  FROM chats c
  LEFT JOIN search_chat_state s ON s.chat_id = c.id
  WHERE s.chat_id IS NULL
     OR s.chunker_version <> current_chunker_version
     OR s.indexed_at IS NULL
     -- Message-driven staleness: a NEW message (cheap via messages_chat_created_idx;
     -- a zero-message chat has NULL max → not flagged) OR a bump of chats.updated_at
     -- (an in-place assistant-reply UPDATE leaves messages.created_at unchanged, so
     -- the reply-finalize path touches the chat to leave a detectable signal here).
     OR s.indexed_at < (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id)
     OR s.indexed_at < c.updated_at
  ORDER BY c.updated_at DESC
  LIMIT max_rows;
$$;--> statement-breakpoint
-- app_rls runs the function body (once ownership is reassigned): BYPASSRLS skips
-- the POLICY check but NOT the table privilege check, so it needs ordinary SELECT
-- on the tables it reads. Granting from `app` (the owner) needs no membership.
GRANT SELECT ON chats, messages, search_chat_state TO app_rls;