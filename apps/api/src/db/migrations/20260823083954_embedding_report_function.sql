-- Hand-authored (Drizzle can't express CREATE FUNCTION — same exception
-- class as 20260823014832_friendly_swarm/20260823033714_stormy_gorgon).
-- chat-search-embeddings/operations (layer 7) — the operator coverage
-- readout's own discovery function.
--
-- WHY A NEW FUNCTION INSTEAD OF WIDENING `llame_search_embedding_coverage`'s
-- `HAVING` IN PLACE: that function's `HAVING count(*) FILTER (WHERE
-- needs_embedding) > 0` hides a chat whose every document is tombstoned —
-- 0 outstanding, 0 embedded, N failed — from its result set entirely, which
-- defeats the three-count contract for an operator whose whole corpus failed
-- to embed. Editing that function's body via `CREATE OR REPLACE FUNCTION` in
-- a later migration is unsafe: `CREATE OR REPLACE` requires the executing
-- role to already OWN the function, but the migrating `app` role only owns
-- it until `pnpm db:provision-rls` reassigns ownership to `app_rls`
-- (BYPASSRLS) — which the deploy runbook says to run "immediately after
-- every fresh db:migrate" (apps/api/AGENTS.md). Any instance that has
-- already provisioned since the coverage function's own migration landed
-- would have `app_rls` as owner by the time this migration runs, and `app`
-- is deliberately never granted membership in `app_rls` (see
-- rls-function-owner.sql's own comment) — so an in-place replace would fail
-- `db:migrate` outright on exactly the instances that deployed correctly.
-- A same-signature sibling function needs no ownership `app` doesn't have,
-- and `llame_search_embedding_coverage` keeps its existing `HAVING` exactly
-- as the `backfill`/sweep discovery consumers need it (outstanding-only
-- worklists) — reporting and worklist discovery are genuinely different
-- consumers with genuinely different predicates.
--
-- The CTE/predicate below is intentionally a byte-for-byte duplicate of
-- `llame_search_embedding_coverage`'s (only the HAVING/ORDER BY differ) —
-- keep the two in sync if the underlying predicate ever changes; the twin's
-- own header comment documents why IS DISTINCT FROM is load-bearing
-- throughout. Same cross-tenant/SECURITY DEFINER/BYPASSRLS/search_path
-- rationale, and the same "identifiers + counts only, never content or a
-- vector" contract. Needs no new GRANT: `20260823014832_friendly_swarm`
-- already granted SELECT on search_chat_documents to app_rls. Ownership is
-- NOT reassigned here for the same reason as the other three discovery
-- functions — see friendly_swarm's comment; until `pnpm db:provision-rls`
-- runs, this is (harmlessly) owned by `app` and does not bypass RLS.
--
-- THIS DUPLICATION IS A KNOWN, ACCEPTED PAST-THE-DEADLINE COST, NOT A
-- PRECEDENT. The right end state was always ONE function with the HAVING/
-- ORDER BY predicate as a parameter — but that decision had to be made
-- before `llame_search_embedding_coverage` first shipped and got provisioned
-- (`CREATE OR REPLACE` needs the executing role to own the function; once
-- `app_rls` owns it, `app` cannot replace it — see the header above). That
-- door is closed for these two specific functions: neither can be collapsed
-- into the other by migration once it has deployed anywhere.
--
-- DO NOT ADD A THIRD PREDICATE VARIANT AS A FOURTH SIBLING FUNCTION. If a
-- future consumer needs yet another HAVING/ORDER BY shape over this same
-- CTE, that is the signal to stop duplicating and design a single
-- parameterized function (predicate variant passed as an argument or a
-- small enum) covering all three — defined in a NEW migration, before
-- `pnpm db:provision-rls` has ever reassigned ITS ownership, so the
-- ownership hazard above never applies to it. Migrate the two existing
-- discovery functions' callers (`backfill`, `search:coverage`, and the
-- sweep) onto the new one and retire `coverage`/`report` once nothing reads
-- them, rather than shipping a third copy of this CTE.
CREATE FUNCTION llame_search_embedding_report(current_model_key text, current_input_version integer, max_rows integer)
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
  -- The one line that differs from llame_search_embedding_coverage: a chat
  -- with zero outstanding but nonzero failed still gets reported, so a
  -- fully-failed corpus is visible instead of silently empty.
  HAVING count(*) FILTER (WHERE needs_embedding) > 0
      OR count(*) FILTER (WHERE has_failure) > 0
  ORDER BY count(*) FILTER (WHERE needs_embedding) DESC,
           count(*) FILTER (WHERE has_failure) DESC
  LIMIT max_rows;
$$;
--> statement-breakpoint
-- Same reasoning as its two siblings: SECURITY DEFINER + a BYPASSRLS owner
-- means the default `EXECUTE TO PUBLIC` is a cross-tenant read. Only `app`
-- needs it.
REVOKE ALL ON FUNCTION llame_search_embedding_report(text, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_embedding_report(text, integer, integer) TO app;
