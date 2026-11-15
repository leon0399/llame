-- Hand-authored (run-steering live updates): Drizzle cannot express CREATE
-- FUNCTION or CREATE TRIGGER, so this migration is manual and the snapshot
-- beside it is a copy of the previous schema. If it is ever regenerated,
-- restore every statement below.
--
-- Extends `llame_notify_change` (20261016125611) with a `chat_deliveries` kind
-- and attaches it to the pending-item table. The whole function is restated
-- because CREATE OR REPLACE cannot add one branch. The payload is a pointer:
-- kind, owner id, and chat id, taken from the row. The hub then loads the
-- Chat's pending items as the owner. Item content never enters NOTIFY, which
-- sits outside RLS. The trigger fires on every INSERT, UPDATE, and DELETE of an
-- item, so a send, a state change, and a withdrawal all reach the owner's
-- devices; a Chat delete cascades through the chats DELETE notification.
--
-- Plain trigger function owned by `app`, not SECURITY DEFINER (P3 does not
-- apply).
CREATE OR REPLACE FUNCTION llame_notify_change() RETURNS trigger AS $$
DECLARE
  payload jsonb;
  run_owner text;
  run_chat uuid;
BEGIN
  IF TG_TABLE_NAME = 'chats' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'chat', 'owner', OLD.owner_user_id,
        'chat', OLD.id, 'deleted', true);
    ELSE
      payload := jsonb_build_object('k', 'chat', 'owner', NEW.owner_user_id,
        'chat', NEW.id, 'deleted', false);
    END IF;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'project', 'owner', OLD.owner_user_id,
        'project', OLD.id, 'deleted', true);
    ELSE
      payload := jsonb_build_object('k', 'project', 'owner', NEW.owner_user_id,
        'project', NEW.id, 'deleted', false);
    END IF;
  ELSIF TG_TABLE_NAME = 'pins' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'pin', 'owner', OLD.user_id);
    ELSE
      payload := jsonb_build_object('k', 'pin', 'owner', NEW.user_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'runs' THEN
    payload := jsonb_build_object('k', 'run', 'owner', NEW.user_id,
      'run', NEW.id, 'status', NEW.status);
  ELSIF TG_TABLE_NAME = 'run_events' THEN
    SELECT r.user_id, r.chat_id INTO run_owner, run_chat
      FROM runs r WHERE r.id = NEW.run_id;
    IF run_owner IS NULL THEN
      RETURN NULL;
    END IF;
    payload := jsonb_build_object('k', 'run_event', 'owner', run_owner,
      'chat', run_chat, 'run', NEW.run_id, 'type', NEW.event_type);
  ELSIF TG_TABLE_NAME = 'chat_deliveries' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'chat_deliveries', 'owner',
        OLD.owner_user_id, 'chat', OLD.chat_id);
    ELSE
      payload := jsonb_build_object('k', 'chat_deliveries', 'owner',
        NEW.owner_user_id, 'chat', NEW.chat_id);
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  IF payload ->> 'owner' IS NOT NULL THEN
    PERFORM pg_notify('llame_changes', payload::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER chat_deliveries_notify_change
  AFTER INSERT OR UPDATE OR DELETE
  ON chat_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();
