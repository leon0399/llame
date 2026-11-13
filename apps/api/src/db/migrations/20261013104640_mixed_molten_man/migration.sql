-- Hand-authored prelude (#1258): `memberships_insert` branch (a) used to let
-- a root's creator grant themselves `owner` at any time, so a creator who
-- transferred ownership and left (or was demoted and left) could re-mint
-- `owner` and revoke the heir. The branch now requires the root to be fresh:
-- no membership rows at all. createRootOrg inserts the unit and the owner row
-- in one transaction, and memberships_last_owner_guard keeps every claimed
-- root owned, so "no rows" means exactly "never bootstrapped".
--
-- The freshness check needs a SECURITY DEFINER helper, not a NOT EXISTS
-- subquery in the policy: the policy runs under the caller's RLS, a departed
-- creator cannot see the root's memberships, and a raw NOT EXISTS would pass.
-- Drizzle cannot express CREATE FUNCTION, so this step is manual. The
-- ALTER POLICY after it is Drizzle-generated from apps/api/src/db/schema/
-- identity.ts; if this migration is ever regenerated, restore the function,
-- REVOKE and GRANT above the ALTER POLICY (the policy cannot resolve a
-- function that does not exist yet).
--
-- The helper returns a boolean only, and only for the caller's own root:
-- someone else's unit, an unknown id, and an absent identity all read
-- `false`, the same answer as a claimed root, so it cannot probe whether
-- another user's unit exists or has members. Like llame_role_on_unit_path it
-- must run AS app_rls (BYPASSRLS; FORCE RLS applies to the owner `app` too).
-- docker/postgres/rls-function-owner.sql reassigns its ownership and
-- re-grants EXECUTE to app after `pnpm db:provision-rls`; migrations run as
-- app, which must never be a member of app_rls. Until provisioning runs, the
-- function's own RLS-filtered read could mistake a departed creator's root
-- for a fresh one, so it fails closed: it returns false whenever its owner
-- lacks BYPASSRLS, which also blocks root bootstrap until provisioning.
-- app_rls already holds SELECT on org_units and memberships (0019).
CREATE FUNCTION llame_org_unit_is_fresh_root(unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  caller text := current_setting('app.current_user_id', true);
BEGIN
  IF caller IS NULL OR caller = '' THEN
    RETURN false;
  END IF;

  -- Inside SECURITY DEFINER, current_user is the function owner.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND r.rolbypassrls
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM org_units u
    WHERE u.id = unit_id
      AND u.parent_id IS NULL
      AND u.created_by = caller
  ) AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.org_unit_id = unit_id
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION llame_org_unit_is_fresh_root(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_org_unit_is_fresh_root(uuid) TO app;--> statement-breakpoint
ALTER POLICY "memberships_insert" ON "memberships" TO public WITH CHECK ((
        user_id = current_setting('app.current_user_id', true)
        AND role = 'owner'
        AND llame_org_unit_is_fresh_root(memberships.org_unit_id)
      ) OR (
        llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner']::org_role[])
      ) OR (
        memberships.role <> 'owner'
        AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin']::org_role[])
      ));
