CREATE INDEX "search_chat_documents_embedding_backlog_idx" ON "search_chat_documents" USING btree ("chat_id","owner_user_id") WHERE embedding IS NULL AND embedding_fail_reason IS NULL;--> statement-breakpoint
-- Hand-appended (Drizzle can't express CREATE FUNCTION — same exception
-- class as 0004/0011/0018/0019/0021/0023/20260712055209_search_projection/
-- 20260823014832_friendly_swarm). chat-search-embeddings, task 6.5/trap 5.
--
-- `llame_search_embedding_coverage` (20260823014832_friendly_swarm) reads
-- ALL FOUR branches of the coverage predicate (model/hash/version changed,
-- OR never attempted) with no WHERE clause, so it full-scans on every call —
-- fine for the operator-invoked, occasional `backfill`/reporting use it
-- serves, wrong for a 5-minute cron. This function reads ONLY the STATIC
-- "never attempted" branch — embedding IS NULL AND embedding_fail_reason IS
-- NULL — which binds no runtime parameter and is exactly what the partial
-- index above serves. The three IS DISTINCT FROM branches are deliberately
-- NOT reachable through this function: they only produce rows after an
-- operator-invoked model change or input-version bump, which is bulk work
-- the explicit `backfill` command must drive (design D6) — this function
-- existing at all is what keeps the sweep structurally unable to turn a
-- config edit into corpus-wide provider spend.
--
-- Same cross-tenant/BYPASSRLS/search_path-pinning rationale as
-- `llame_search_embedding_coverage` and `llame_search_stale_chats`: SECURITY
-- DEFINER, runs AS app_rls once db:provision-rls reassigns ownership (see
-- rls-function-owner.sql), returns identifiers + a count only, never content
-- or a vector. Ownership is NOT reassigned here for the same reason as the
-- other two — see 20260823014832_friendly_swarm's comment.
CREATE FUNCTION llame_search_embedding_backlog(max_rows integer)
RETURNS TABLE (chat_id uuid, owner_user_id text, outstanding_count integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT chat_id, owner_user_id, count(*)::int AS outstanding_count
  FROM search_chat_documents
  WHERE embedding IS NULL AND embedding_fail_reason IS NULL
  GROUP BY chat_id, owner_user_id
  ORDER BY count(*) DESC
  LIMIT max_rows;
$$;
--> statement-breakpoint
-- Same reasoning as `llame_search_embedding_coverage` in
-- 20260823014832_friendly_swarm: SECURITY DEFINER + a BYPASSRLS owner means the
-- default `EXECUTE TO PUBLIC` is a cross-tenant read. Only `app` needs it.
REVOKE ALL ON FUNCTION llame_search_embedding_backlog(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_embedding_backlog(integer) TO app;
