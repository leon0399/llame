-- Hand-appended (Drizzle can't express CREATE EXTENSION, CREATE FUNCTION, or
-- GRANT — chat-search-embeddings; same exception class as 0004/0011/0018/
-- 0019/0021/0023/20260712055209_search_projection). Unlike `pg_trgm`, `vector`
-- (pgvector) is NOT a trusted extension — its control file carries no
-- `trusted = true`, so PostgreSQL requires superuser to install it (verified
-- empirically: "permission denied to create extension \"vector\" ... Must be
-- superuser"). The non-superuser `app` role that runs this migration cannot
-- create it itself, so `docker/postgres/initdb/03-vector-extension.sql`
-- provisions it ONCE as the `postgres` superuser on a fresh volume, before
-- any migration runs (mirrors `app_rls` in 02-app-rls-role.sql). The
-- statement below is therefore a defensive no-op for `app` once provisioned
-- — IF NOT EXISTS checks existence before the permission check, so it
-- succeeds — and fails loudly with a clear permission error, rather than a
-- confusing missing-type error later, on an unprovisioned instance. It MUST
-- precede the "embedding" column ADD COLUMN below, which uses the `vector`
-- type.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "embedding_model_bindings" (
	"model_key" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"revision" text,
	"dimensions" integer NOT NULL,
	"distance_metric" text DEFAULT 'cosine' NOT NULL,
	"document_prefix" text,
	"query_prefix" text,
	"batch_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "embedding_model_key" text;--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "embedded_content_hash" text;--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "embed_input_version" integer;--> statement-breakpoint
ALTER TABLE "search_chat_documents" ADD COLUMN "embedding_fail_reason" text;--> statement-breakpoint
-- `app_rls` has SELECT on chats/messages/search_chat_state from the phase-1
-- migration (20260712055209_search_projection) but NOT on this table. BYPASSRLS
-- skips the POLICY check but NOT the table privilege check, so the coverage
-- function below — which runs AS app_rls once ownership is reassigned — needs
-- ordinary SELECT here. Granting from `app` (the owner) needs no membership.
GRANT SELECT ON search_chat_documents TO app_rls;--> statement-breakpoint
-- Cross-tenant embedding-coverage discovery (chat-search-embeddings, design
-- D10). Enumerating embedding lag spans ALL tenants, which a plain runAs
-- identity cannot do under FORCE RLS — so this is SECURITY DEFINER and, like
-- `llame_search_stale_chats` (20260712055209_search_projection), runs AS
-- `app_rls` (BYPASSRLS is the only thing that outranks FORCE). It returns
-- ONLY identifiers + counts, never content and never a vector.
--
-- IS DISTINCT FROM throughout is load-bearing, not stylistic: a never-
-- embedded row has NULL embedding_model_key/embed_input_version, so plain
-- `=` against the current model/version would evaluate to NULL rather than
-- true, and the negated form used by `<>`/`=` comparisons in a boolean
-- expression would silently exclude it — never-embedded documents would
-- never be discovered, with no error (D10).
--
-- `search_path` pinned against the SECURITY DEFINER search-path hijack — this
-- function runs as a BYPASSRLS role, so omitting this would be the most
-- dangerous line in the migration.
--
-- Ownership is NOT reassigned here (same reason as the phase-1 function:
-- `ALTER FUNCTION ... OWNER TO app_rls` needs `app` to be a member of
-- `app_rls`, which would also grant SET ROLE app_rls / BYPASSRLS directly).
-- The reassignment runs as the `postgres` superuser via
-- docker/postgres/rls-function-owner.sql (`pnpm db:provision-rls`). Until
-- then it is (harmlessly) owned by `app` and does not bypass RLS, so the
-- embedding worker's discovery sweep (a later layer) sees only its own rows —
-- exactly the silent-zero-rows failure the boot self-check exists to make
-- visible.
-- SCAN CHARACTERISTIC (measured during review, recorded so the layer that wires
-- this to the sweep does not rediscover it): the CTE below has no WHERE clause,
-- so every call reads every document of every tenant, aggregates, and only then
-- applies HAVING/ORDER BY/LIMIT — `max_rows` bounds the OUTPUT, never the scan.
-- Nothing calls this function yet, so the cost is currently zero; it becomes a
-- full-corpus scan on every sweep tick once a consumer exists.
--
-- The OR has two kinds of branch, and they differ in what can be done about it:
--   * `embedding IS NULL AND embedding_fail_reason IS NULL` (never attempted) is
--     a STATIC predicate, so it is indexable with a partial index. This is the
--     steady-state case a periodic sweep hits forever.
--   * the three IS DISTINCT FROM branches compare against runtime bind
--     parameters and are not sargable by any static index — but they only
--     produce rows after an operator changes the model or bumps the input
--     version, which is precisely when the explicit backfill command runs.
-- So the frequent path is indexable and the unindexable paths are rare and
-- operator-initiated. Add the partial index with the consumer, not here, where
-- nothing reads these columns yet.
CREATE FUNCTION llame_search_embedding_coverage(current_model_key text, current_input_version integer, max_rows integer)
RETURNS TABLE (chat_id uuid, owner_user_id text, outstanding_count integer, embedded_count integer, failed_count integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH classified AS (
    SELECT
      chat_id,
      owner_user_id,
      (
        embedding_model_key      IS DISTINCT FROM current_model_key
        OR embedded_content_hash IS DISTINCT FROM content_hash
        OR embed_input_version   IS DISTINCT FROM current_input_version
        OR (embedding IS NULL AND embedding_fail_reason IS NULL)
      ) AS needs_embedding,
      (embedding IS NOT NULL) AS has_embedding,
      (embedding_fail_reason IS NOT NULL) AS has_failure
    FROM search_chat_documents
  )
  SELECT
    chat_id,
    owner_user_id,
    count(*) FILTER (WHERE needs_embedding)::int AS outstanding_count,
    count(*) FILTER (WHERE NOT needs_embedding AND has_embedding)::int AS embedded_count,
    count(*) FILTER (WHERE NOT needs_embedding AND has_failure)::int AS failed_count
  FROM classified
  GROUP BY chat_id, owner_user_id
  HAVING count(*) FILTER (WHERE needs_embedding) > 0
  ORDER BY count(*) FILTER (WHERE needs_embedding) DESC
  LIMIT max_rows;
$$;
--> statement-breakpoint
-- A SECURITY DEFINER function runs with its owner's rights, and after
-- `pnpm db:provision-rls` that owner is the BYPASSRLS `app_rls` role — so the
-- default `EXECUTE TO PUBLIC` would hand every role a cross-tenant read of
-- chat/owner identifiers that FORCE RLS exists to deny. Only `app`, the role
-- the application connects as, needs it. Today `app` is the sole LOGIN role so
-- PUBLIC is effectively just `app`, but that is a property of the current
-- deployment, not a guarantee — a reporting or read-only role added later must
-- not silently inherit this.
REVOKE ALL ON FUNCTION llame_search_embedding_coverage(text, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_embedding_coverage(text, integer, integer) TO app;
