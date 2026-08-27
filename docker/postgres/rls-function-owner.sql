-- Run AFTER every `db:migrate` that (re)creates `llame_role_on_unit_path`
-- (org-units change, D4) — as the `postgres` superuser: `pnpm db:provision-rls`
-- (scripts/rls-test.sh runs the equivalent against its own throwaway
-- container). Idempotent: safe to re-run on every migrate.
--
-- Why this isn't a migration statement: `ALTER FUNCTION ... OWNER TO`
-- requires the current role to be a MEMBER of the new owning role. Granting
-- that membership to `app` (the migration-running role) so it could do this
-- itself would ALSO let `app` `SET ROLE app_rls` and assume BYPASSRLS
-- directly — Postgres reuses the exact same permission check for both, so
-- restricting it with `GRANT app_rls TO app WITH SET FALSE` doesn't help
-- either (verified empirically: `ALTER FUNCTION` still fails with "must be
-- able to SET ROLE" under it). Rather than hand `app` a path around FORCE
-- ROW LEVEL SECURITY just to work around that, this ownership assignment
-- runs as `postgres` (superuser), which bypasses the membership check
-- entirely and needs no privilege grants on `app_rls`'s behalf. Function
-- evolution for this one function is therefore a provisioning concern, not
-- a migration concern (docker/postgres/initdb/02-app-rls-role.sql provisions
-- the role itself; this provisions what it owns).
--
-- Until this runs after a fresh migrate, `llame_role_on_unit_path` is
-- (harmlessly) owned by `app` and does NOT bypass RLS — the memberships
-- policies that call it will not see the rows they need. Run this
-- immediately after migrating, before serving real traffic.
ALTER FUNCTION llame_role_on_unit_path(uuid, org_role[]) OWNER TO app_rls;
-- chat-search-platform (#195): the reindex-sweep staleness-discovery function
-- must also run AS app_rls (BYPASSRLS) to enumerate chats across all tenants
-- under FORCE RLS. Same rationale as above; it returns only identifiers +
-- timestamps, never content. Idempotent; safe to re-run on every migrate.
ALTER FUNCTION llame_search_stale_chats(integer, integer) OWNER TO app_rls;
-- chat-search-embeddings (design D10): the embedding-coverage discovery
-- function must also run AS app_rls (BYPASSRLS) to enumerate embedding lag
-- across all tenants under FORCE RLS. Same rationale as above; it returns
-- only identifiers + counts, never content or vectors. Idempotent; safe to
-- re-run on every migrate.
ALTER FUNCTION llame_search_embedding_coverage(text, integer, integer) OWNER TO app_rls;
-- The migration grants EXECUTE while `app` still owns the function. Owner
-- privileges are implicit rather than a durable ACL entry, so transferring
-- ownership removes `app`'s ability to call this PUBLIC-revoked function.
-- Re-grant after the transfer, when it becomes a real explicit privilege.
GRANT EXECUTE ON FUNCTION llame_search_embedding_coverage(text, integer, integer) TO app;
-- chat-search-embeddings (task 6.5/trap 5): the embedding-backlog sweep
-- function (the STATIC never-attempted-only branch, servable by the partial
-- index) must also run AS app_rls (BYPASSRLS) to enumerate incremental
-- embedding lag across all tenants under FORCE RLS. Same rationale as above;
-- it returns only identifiers + a count, never content or vectors.
-- Idempotent; safe to re-run on every migrate.
ALTER FUNCTION llame_search_embedding_backlog(integer) OWNER TO app_rls;
GRANT EXECUTE ON FUNCTION llame_search_embedding_backlog(integer) TO app;
-- chat-search-embeddings/operations (layer 7): the coverage READOUT's own
-- discovery function (deliberately a same-signature sibling of
-- llame_search_embedding_coverage, not an in-place edit of it — see
-- 20260823083954_embedding_report_function.sql's header for why) must also
-- run AS app_rls (BYPASSRLS) to enumerate embedding coverage across all
-- tenants under FORCE RLS. Same rationale as above; it returns only
-- identifiers + counts, never content or vectors. Idempotent; safe to
-- re-run on every migrate.
ALTER FUNCTION llame_search_embedding_report(text, integer, integer) OWNER TO app_rls;
GRANT EXECUTE ON FUNCTION llame_search_embedding_report(text, integer, integer) TO app;
-- conversation provenance reads (#609, projection layer): the v2 locator-aware
-- stale-chat discovery function must also run AS app_rls (BYPASSRLS) so the
-- reindex sweep can find incomplete current-version rows across all tenants.
-- It returns only chat identifiers + timestamps; message content stays inside
-- the owner's reindex transaction. Idempotent; safe to re-run on every migrate.
ALTER FUNCTION llame_search_projection_stale_chats_v2(integer, integer) OWNER TO app_rls;
GRANT EXECUTE ON FUNCTION llame_search_projection_stale_chats_v2(integer, integer) TO app;
-- The model-independent aggregate cutover readout is likewise owned by
-- app_rls. It returns counts only and is intentionally not a public/model
-- surface. Re-grant to app after ownership transfer because owner privileges
-- are implicit and the migration's explicit grant must remain durable.
ALTER FUNCTION llame_search_projection_coverage_v2(integer) OWNER TO app_rls;
GRANT EXECUTE ON FUNCTION llame_search_projection_coverage_v2(integer) TO app;
