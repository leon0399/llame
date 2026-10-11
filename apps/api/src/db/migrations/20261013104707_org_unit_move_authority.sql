-- Hand-authored (#1260): Drizzle cannot express CREATE FUNCTION or
-- CREATE [CONSTRAINT] TRIGGER, so this whole migration is manual and the
-- snapshot beside it is unchanged. If it is ever regenerated, restore every
-- statement below. Same shape as 0019 (D1/D2): plain trigger functions owned
-- by `app`, not SECURITY DEFINER. They read rows the caller cannot see
-- through the `org_units_trigger_read` / `memberships_trigger_read`
-- policies (`pg_trigger_depth() > 0`), so nothing needs provisioning.
--
-- `org_units_update` checks admin tier on the old path (USING) and the new
-- path (WITH CHECK). A policy cannot compare the two, so it let an `admin`:
--   * promote a unit to root: the new path is the unit's own id, so one
--     `admin` row on the unit passes, and the root ends with no owner (F1);
--   * move a unit into another tree they own, gaining owner tier over it and
--     its owners (F2);
--   * rewrite `created_by`, which feeds the creator visibility edge and the
--     fresh-root owner self-grant (#1258).
-- And the last-owner guard skipped any UPDATE that kept role = 'owner', so
-- the sole owner of a root could move their row to another unit (F3).
--
-- 1. `org_units_update_authority` (BEFORE UPDATE, per row):
--    * `created_by` never changes. The one exception is the FK's
--      ON DELETE SET NULL when the user is deleted; that UPDATE runs inside
--      the RI trigger, so pg_trigger_depth() > 1, which a caller's own
--      statement can never reach.
--    * A row whose path changes its first segment (its root) leaves its
--      tree: the caller needs `owner` on the row's current path. Every row
--      of a moved subtree takes this branch, and the moved unit's own row
--      needs owner on its source path. Moves inside one tree keep the
--      admin-tier policy. 42501 like any RLS denial, so the API maps it to
--      403.
-- 2. `org_units_promoted_root_owned` (deferred constraint trigger): a unit
--    whose parent_id became NULL must have an `owner` membership at commit.
--    Deferred because the move and the owner grant may come in either order
--    within one transaction. It takes the same advisory lock as the
--    last-owner guard, so a concurrent revoke of the unit's owner and the
--    promotion serialize: whichever runs second sees the other committed.
--    OW001, the last-owner SQLSTATE: same invariant (no ownerless root).
-- 3. `assert_last_owner_retained` (0019) now also guards an owner row whose
--    org_unit_id changes, as a removal from the old unit. It is a plain
--    trigger function owned by `app`, so CREATE OR REPLACE is safe here
--    (P3 concerns the app_rls-owned SECURITY DEFINER helpers only).
CREATE OR REPLACE FUNCTION assert_org_unit_update_authority() RETURNS trigger AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     AND NOT (NEW.created_by IS NULL AND pg_trigger_depth() > 1) THEN
    RAISE EXCEPTION 'org unit % created_by cannot be changed', OLD.id
      USING ERRCODE = '42501';
  END IF;

  IF split_part(NEW.path, '/', 1) <> split_part(OLD.path, '/', 1)
     AND NOT EXISTS (
       SELECT 1 FROM memberships m
       WHERE m.user_id = current_setting('app.current_user_id', true)
         AND m.role = 'owner'
         AND m.org_unit_id::text = ANY(string_to_array(OLD.path, '/'))
     ) THEN
    RAISE EXCEPTION 'moving org unit % out of its tree requires owner on its current path', OLD.id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER org_units_update_authority
  BEFORE UPDATE ON org_units
  FOR EACH ROW
  WHEN (
    OLD.created_by IS DISTINCT FROM NEW.created_by
    OR split_part(OLD.path, '/', 1) <> split_part(NEW.path, '/', 1)
  )
  EXECUTE FUNCTION assert_org_unit_update_authority();--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_promoted_root_owned() RETURNS trigger AS $$
DECLARE
  current_parent uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text, 0));

  SELECT parent_id INTO current_parent FROM org_units WHERE id = NEW.id;
  IF NOT FOUND OR current_parent IS NOT NULL THEN
    RETURN NEW; -- deleted, or moved under a parent again, before commit
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships WHERE org_unit_id = NEW.id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'org unit % cannot become a root without an owner — grant owner on it first', NEW.id
      USING ERRCODE = 'OW001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- OR REPLACE is not supported for constraint triggers; drop-then-create
-- keeps a rerun safe.
DROP TRIGGER IF EXISTS org_units_promoted_root_owned ON org_units;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER org_units_promoted_root_owned
  AFTER UPDATE OF parent_id ON org_units
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.parent_id IS NOT NULL AND NEW.parent_id IS NULL)
  EXECUTE FUNCTION assert_promoted_root_owned();--> statement-breakpoint
-- Unchanged from 0019 except the early return: an UPDATE that keeps
-- role = 'owner' passes only when org_unit_id stays the same too. See 0019
-- for the advisory-lock rationale.
CREATE OR REPLACE FUNCTION assert_last_owner_retained() RETURNS trigger AS $$
DECLARE
  unit_row org_units%ROWTYPE;
  remaining_owners integer;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.org_unit_id = OLD.org_unit_id THEN
    RETURN NEW; -- still an owner of the same unit afterward — nothing to protect against
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
$$ LANGUAGE plpgsql;
