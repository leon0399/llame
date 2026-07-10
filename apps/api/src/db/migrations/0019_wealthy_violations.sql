-- Hand-appended (like 0004/0006/0011/0013/0018 — Drizzle cannot express
-- CREATE ROLE, CREATE FUNCTION, ALTER … OWNER TO, or CREATE [CONSTRAINT]
-- TRIGGER). org-units change, decisions D1/D2/D4 (see design.md).
--
-- D4: `llame_role_on_unit_path` is the BYPASSRLS escape hatch that lets
-- `memberships` policies check "member/admin on the unit's path" without a
-- policy self-reference cycle (org_units' own SELECT policy already scans
-- memberships; a memberships policy scanning org_units back would close the
-- loop). It is SECURITY DEFINER, and needs to run AS the `app_rls` role
-- provisioned in docker/postgres/initdb/02-app-rls-role.sql (BYPASSRLS —
-- plain SECURITY DEFINER owned by `app` would still be caught by FORCE ROW
-- LEVEL SECURITY, since FORCE applies policies to the table owner too;
-- BYPASSRLS is the only thing that outranks FORCE). `search_path` is pinned
-- to guard against the classic SECURITY DEFINER search-path hijack.
--
-- Created here, before the policies below that call it (CREATE POLICY/ALTER
-- POLICY would fail to resolve an as-yet-nonexistent function), but its
-- ownership is reassigned to `app_rls` by a SEPARATE superuser-run
-- provisioning step, not by this migration — see the comment just above the
-- `GRANT SELECT` below for why.
CREATE FUNCTION llame_role_on_unit_path(unit_id uuid, roles org_role[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  caller text := current_setting('app.current_user_id', true);
  unit_path text;
BEGIN
  -- Fail closed on absent/empty identity context, same contract as every
  -- other policy in this schema (roleInPath, TenantDbService.runAs).
  IF caller IS NULL OR caller = '' THEN
    RETURN false;
  END IF;

  SELECT path INTO unit_path FROM org_units WHERE id = unit_id;
  IF unit_path IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = caller
      AND m.role = ANY(roles)
      AND m.org_unit_id::text = ANY(string_to_array(unit_path, '/'))
  );
END;
$$;--> statement-breakpoint
-- Ownership is intentionally NOT reassigned here: `ALTER FUNCTION ... OWNER TO
-- app_rls` needs the current role (`app`, which runs this migration) to be a
-- member of `app_rls`, and granting that membership would also let `app`
-- `SET ROLE app_rls` and assume BYPASSRLS directly (same permission check;
-- verified `WITH SET FALSE` doesn't avoid it either). So this function is
-- created here (owned by `app`, like any other migration-created object) and
-- its ownership is reassigned to `app_rls` by a SEPARATE, superuser-run
-- provisioning step — see docker/postgres/rls-function-owner.sql — which is
-- NOT subject to the membership check at all. Until that step runs, this
-- function is (harmlessly) owned by `app` and does not yet bypass RLS.
--
-- The function runs AS app_rls once reassigned (SECURITY DEFINER), so
-- app_rls itself needs ordinary table-level SELECT on both tables to read
-- them at all — BYPASSRLS only skips the POLICY check, it doesn't imply a
-- privilege grant. Without this, every call fails outright with "permission
-- denied for table …" rather than just seeing zero rows. Granting this from
-- `app` (the table owner) needs no membership — only ownership reassignment does.
GRANT SELECT ON org_units, memberships TO app_rls;--> statement-breakpoint
CREATE POLICY "memberships_trigger_read" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING (pg_trigger_depth() > 0);--> statement-breakpoint
CREATE POLICY "org_units_trigger_read" ON "org_units" AS PERMISSIVE FOR SELECT TO public USING (pg_trigger_depth() > 0);--> statement-breakpoint
ALTER POLICY "memberships_select" ON "memberships" TO public USING (user_id = current_setting('app.current_user_id', true) OR llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin','maintainer','member','viewer','guest','service_account']::org_role[]));--> statement-breakpoint
ALTER POLICY "memberships_insert" ON "memberships" TO public WITH CHECK ((
        user_id = current_setting('app.current_user_id', true)
        AND role = 'owner'
        AND EXISTS (
          SELECT 1 FROM org_units u
          WHERE u.id = memberships.org_unit_id
            AND u.parent_id IS NULL
            AND u.created_by = current_setting('app.current_user_id', true)
        )
      ) OR (
        llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner']::org_role[])
      ) OR (
        memberships.role <> 'owner'
        AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin']::org_role[])
      ));--> statement-breakpoint
ALTER POLICY "memberships_update" ON "memberships" TO public USING ((
        memberships.role <> 'owner' AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin']::org_role[])
      ) OR llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner']::org_role[])) WITH CHECK ((
        memberships.role <> 'owner' AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin']::org_role[])
      ) OR (
        memberships.role = 'owner' AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner']::org_role[])
      ));--> statement-breakpoint
ALTER POLICY "memberships_delete" ON "memberships" TO public USING (
        user_id = current_setting('app.current_user_id', true)
        OR (memberships.role <> 'owner' AND llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner','admin']::org_role[]))
        OR llame_role_on_unit_path(memberships.org_unit_id, ARRAY['owner']::org_role[])
      );--> statement-breakpoint
-- D1: DB-enforced org_units path/parent invariant (spec: "Direct SQL cannot
-- corrupt the tree"). The assertion below runs first and aborts the whole
-- migration if any pre-existing row already violates the invariant, rather
-- than silently installing a trigger over corrupt data — none is expected
-- (the repository has always computed paths correctly), but this makes that
-- an explicit, checked assumption instead of an implicit one.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM org_units u
  LEFT JOIN org_units p ON p.id = u.parent_id
  WHERE (u.parent_id IS NULL AND u.path <> u.id::text)
     OR (u.parent_id IS NOT NULL AND (p.id IS NULL OR u.path <> p.path || '/' || u.id::text));
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'org_units: % row(s) already violate the path/parent invariant — refusing to install the integrity trigger over corrupt data', bad_count;
  END IF;
END;
$$;--> statement-breakpoint
-- DEFERRABLE INITIALLY DEFERRED — to commit, not per-statement — because
-- move() legitimately passes through intermediate states: the subtree path
-- rewrite and the moved unit's parent_id update are two separate UPDATE
-- statements (identity-repository.ts), each of which queues its OWN trigger
-- event carrying the NEW row AS OF THAT STATEMENT. Deferring WHEN the check
-- runs (to commit) does not merge those two events into one — Postgres still
-- checks each queued event's captured NEW value independently, and the
-- FIRST event's NEW (path already rewritten, parent_id not yet updated, or
-- vice versa, depending on statement order) is transiently inconsistent by
-- construction. So this function ignores the passed-in NEW for validation
-- and re-reads the row by id instead: by the time ANY deferred check for
-- this trigger actually executes (just before commit), both of move()'s
-- statements have applied, and a fresh read reflects that final, fully
-- consistent state — regardless of which of the row's (possibly several)
-- queued events is being resolved. Row locking (identity-repository.ts,
-- createChild/move) is the primary defense against a concurrent writer
-- observing a stale parent path; this trigger is the backstop against
-- corruption reaching a COMMIT at all, including via direct SQL.
CREATE FUNCTION assert_org_unit_path_integrity() RETURNS trigger AS $$
DECLARE
  current_row org_units%ROWTYPE;
  parent_path text;
BEGIN
  SELECT * INTO current_row FROM org_units WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NEW; -- row no longer exists as of commit-check time — nothing to validate
  END IF;

  IF current_row.parent_id IS NULL THEN
    IF current_row.path <> current_row.id::text THEN
      RAISE EXCEPTION 'org unit % must have path = id when parent_id is NULL (got %)', current_row.id, current_row.path
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT path INTO parent_path FROM org_units WHERE id = current_row.parent_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'org unit % references a non-existent parent %', current_row.id, current_row.parent_id
        USING ERRCODE = '23514';
    END IF;
    IF current_row.path <> parent_path || '/' || current_row.id::text THEN
      RAISE EXCEPTION 'org unit % path (%) does not match parent %''s current path (%)', current_row.id, current_row.path, current_row.parent_id, parent_path
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Review finding F2: the checks above only look UPWARD (this row against
  -- its parent). A write that reparents a unit to a new, internally
  -- self-consistent path WITHOUT rewriting that unit's own descendants would
  -- pass them — the descendants weren't touched, so no trigger event fires
  -- for them at all, and they'd silently end up with paths that no longer
  -- match their (unmodified) parent_id's new path. Checking DOWNWARD too —
  -- this row's DIRECT children against ITS current path — closes that: any
  -- inconsistent parent/child edge has at least one modified endpoint (the
  -- edge was consistent before, by induction from the installation-time DO
  -- block assertion and every prior write), and every modified row checks
  -- both directions, so the edge is caught from whichever side changed.
  IF EXISTS (
    SELECT 1 FROM org_units child
    WHERE child.parent_id = current_row.id
      AND child.path <> current_row.path || '/' || child.id::text
  ) THEN
    RAISE EXCEPTION 'org unit % has at least one child whose path does not match its current path (%)', current_row.id, current_row.path
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER org_units_path_integrity
  AFTER INSERT OR UPDATE ON org_units
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_org_unit_path_integrity();--> statement-breakpoint
-- D2: DB-enforced last-owner protection, independent of application code
-- (spec: last-owner cannot leave/be-demoted; deleting a last-owner user is
-- blocked; concurrent departures cannot orphan the org — review finding F3).
-- BEFORE UPDATE OR DELETE fires ahead of the write landing, so it can veto
-- demoting or revoking the sole remaining owner of a ROOT unit (non-root
-- units inherit administration from ancestors — no local owner requirement).
-- A custom SQLSTATE ('OW001', not one PostgreSQL defines) distinguishes this
-- from the path-integrity trigger's 23514 so the service layer can map each
-- to a different message ("transfer ownership first" vs. "concurrent
-- reorganization, retry"). Unit-cascade deletes (deleting the org unit
-- itself, which cascades to its memberships) pass: by the time this fires
-- for the cascaded row, the org_units row has already been deleted within
-- the same command (visible as gone via the command counter), so the "does
-- the unit still exist" check below lets that case through.
--
-- F3: without locking, two co-owners leaving in concurrent transactions each
-- count the OTHER's still-uncommitted row as "remaining", so both see
-- remaining_owners = 1 and both commit — an ownerless org. A transaction-
-- scoped advisory lock keyed by the org unit id is the shared lock point:
-- the loser blocks until the winner commits (or rolls back), then its
-- remaining-owners count runs against the winner's already-settled state.
--
-- This is a `pg_advisory_xact_lock`, NOT `SELECT ... FOR UPDATE` on the
-- org_units row, despite that being the more obvious choice (and what D1's
-- own locking uses at the application layer) — empirically, `SELECT id FROM
-- org_units WHERE id = … FOR UPDATE` from *inside this trigger* intermittently
-- returns NOT FOUND for a row that demonstrably still exists, specifically
-- when the SAME pooled connection previously ran this trigger to an abort
-- (a prior BEFORE trigger invocation that itself raised an exception and
-- rolled back) — reproduced outside Jest with a bare postgres.js script, and
-- disappears with either separate connections or no FOR UPDATE. The org_units
-- row is a red herring for this lock anyway (this only needs to serialize
-- concurrent *membership* writes for the same unit, not read/write the unit
-- itself), so an advisory lock sidesteps the anomaly entirely rather than
-- chasing its root cause — likely an interaction between RLS's EvalPlanQual
-- re-check path for FOR UPDATE and the `pg_trigger_depth() > 0` permissive
-- policy, but not confirmed further.
CREATE FUNCTION assert_last_owner_retained() RETURNS trigger AS $$
DECLARE
  unit_row org_units%ROWTYPE;
  remaining_owners integer;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
    RETURN NEW; -- still an owner afterward — nothing to protect against
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.org_unit_id::text, 0));

  SELECT * INTO unit_row FROM org_units WHERE id = OLD.org_unit_id;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD); -- the unit itself is gone (cascade delete) — allow
  END IF;
  IF unit_row.parent_id IS NOT NULL THEN
    RETURN COALESCE(NEW, OLD); -- non-root units don't need a local owner
  END IF;

  SELECT count(*) INTO remaining_owners
  FROM memberships
  WHERE org_unit_id = OLD.org_unit_id
    AND role = 'owner'
    AND id <> OLD.id;
  IF remaining_owners = 0 THEN
    RAISE EXCEPTION 'cannot remove the last owner of root org unit % — transfer ownership first', OLD.org_unit_id
      USING ERRCODE = 'OW001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER memberships_last_owner_guard
  BEFORE UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION assert_last_owner_retained();
