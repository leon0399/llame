-- Hand-authored (live updates): Drizzle cannot express CREATE FUNCTION or
-- CREATE TRIGGER, so this whole migration is manual and the snapshot beside it
-- is unchanged. If it is ever regenerated, restore every statement below.
--
-- `llame_notify_change` sends one `pg_notify('llame_changes', <json>)` per
-- changed row of chats, projects, pins, runs and run_events. The API's live
-- change hub LISTENs on that channel and forwards owner-scoped invalidations
-- to that owner's WebSocket connections.
--
-- Payloads are pointers, never record content: kind, operation, owner id,
-- record ids, and for runs the status and for run_events the sequence and
-- event type. NOTIFY channels are database-global and outside RLS, so a title,
-- message text or tool output must never be placed here. NOTIFY inside a
-- transaction is delivered only on commit, so a rolled-back write sends
-- nothing.
--
-- The owner always comes from the database row, never from a caller. A
-- run_events row carries only run_id, so its owner and chat are read from
-- runs under the writer's own RLS identity; when that lookup finds nothing
-- the trigger sends nothing. The function never raises: a failing AFTER
-- trigger would fail the write it is attached to.
--
-- No DELETE trigger on runs or run_events: deleting a chat cascades through
-- every run event, and the chats DELETE notification already covers it.
--
-- Plain trigger function owned by `app`, not SECURITY DEFINER, so nothing
-- needs provisioning and CREATE OR REPLACE is safe (P3 does not apply).
CREATE OR REPLACE FUNCTION llame_notify_change() RETURNS trigger AS $$
DECLARE
  payload jsonb;
  run_owner text;
  run_chat uuid;
BEGIN
  IF TG_TABLE_NAME = 'chats' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'chat', 'op', 'delete',
        'owner', OLD.owner_user_id, 'chat', OLD.id);
    ELSE
      payload := jsonb_build_object('k', 'chat', 'op', lower(TG_OP),
        'owner', NEW.owner_user_id, 'chat', NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'project', 'op', 'delete',
        'owner', OLD.owner_user_id, 'project', OLD.id);
    ELSE
      payload := jsonb_build_object('k', 'project', 'op', lower(TG_OP),
        'owner', NEW.owner_user_id, 'project', NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'pins' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'pin', 'op', 'delete',
        'owner', OLD.user_id, 'item', OLD.item_id);
    ELSE
      payload := jsonb_build_object('k', 'pin', 'op', lower(TG_OP),
        'owner', NEW.user_id, 'item', NEW.item_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'runs' THEN
    payload := jsonb_build_object('k', 'run', 'op', lower(TG_OP),
      'owner', NEW.user_id, 'chat', NEW.chat_id, 'run', NEW.id,
      'status', NEW.status);
  ELSIF TG_TABLE_NAME = 'run_events' THEN
    SELECT r.user_id, r.chat_id INTO run_owner, run_chat
      FROM runs r WHERE r.id = NEW.run_id;
    IF run_owner IS NULL THEN
      RETURN NULL;
    END IF;
    payload := jsonb_build_object('k', 'run_event', 'op', 'insert',
      'owner', run_owner, 'chat', run_chat, 'run', NEW.run_id,
      'seq', NEW.sequence, 'type', NEW.event_type);
  ELSE
    RETURN NULL;
  END IF;

  IF payload ->> 'owner' IS NOT NULL THEN
    PERFORM pg_notify('llame_changes', payload::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER chats_notify_change
  AFTER INSERT OR DELETE OR UPDATE OF title, updated_at, archived_at, project_id, visibility
  ON chats
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();--> statement-breakpoint
CREATE OR REPLACE TRIGGER projects_notify_change
  AFTER INSERT OR DELETE OR UPDATE OF name, updated_at, archived_at
  ON projects
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();--> statement-breakpoint
CREATE OR REPLACE TRIGGER pins_notify_change
  AFTER INSERT OR DELETE OR UPDATE OF position
  ON pins
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();--> statement-breakpoint
CREATE OR REPLACE TRIGGER runs_notify_insert
  AFTER INSERT
  ON runs
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();--> statement-breakpoint
CREATE OR REPLACE TRIGGER runs_notify_status
  AFTER UPDATE OF status
  ON runs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION llame_notify_change();--> statement-breakpoint
CREATE OR REPLACE TRIGGER run_events_notify_insert
  AFTER INSERT
  ON run_events
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();
