-- Hand-authored (live updates): Drizzle cannot express CREATE FUNCTION or
-- CREATE TRIGGER, so this migration is manual and the snapshot beside it is a
-- copy of the previous schema. If it is ever regenerated, restore every
-- statement below.
--
-- `machines_status` is an INSTANCE-WIDE record: every authenticated user may
-- read the Machines list, so the live hub pushes a changed or removed Machine
-- to every open connection instead of one owner. Its notification therefore
-- carries no owner — the owner-scoped `llame_notify_change` (20261016125611)
-- keeps its own function, and this one is separate so that its owner-only
-- guard stays untouched.
--
-- Payloads are pointers, never record content: the kind, the Machine name, and
-- whether the row was deleted. NOTIFY channels are database-global and outside
-- RLS, so a name is the most that may be placed here (it is already the
-- primary key every user reads). NOTIFY inside a transaction is delivered only
-- on commit, so a rolled-back write sends nothing.
--
-- The trigger fires on every INSERT and UPDATE: the probe re-stamps
-- `last_contact_at` on a successful contact and `last_failure_at` on a failed
-- one, and the hub decides online or offline itself when it reads the row. It
-- also fires on DELETE, because the probe prunes the rows of Machines the
-- operator removed; the deletion is what tells a connected client to drop the
-- Machine instead of keeping a stale "online".
--
-- The function never raises: a failing AFTER trigger would fail the write it
-- is attached to.
--
-- Plain trigger function owned by `app`, not SECURITY DEFINER, so nothing
-- needs provisioning and CREATE OR REPLACE is safe (P3 does not apply).
CREATE OR REPLACE FUNCTION llame_notify_machine_change() RETURNS trigger AS $$
DECLARE
  payload jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    payload := jsonb_build_object('k', 'machine', 'machine', OLD.name,
      'deleted', true);
  ELSE
    payload := jsonb_build_object('k', 'machine', 'machine', NEW.name,
      'deleted', false);
  END IF;
  PERFORM pg_notify('llame_changes', payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER machines_status_notify_change
  AFTER INSERT OR UPDATE OR DELETE
  ON machines_status
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_machine_change();
