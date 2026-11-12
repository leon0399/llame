-- Hand-authored (background-jobs live projection): Drizzle cannot generate
-- trigger functions or triggers. Regeneration must restore this whole function
-- and the chat_jobs trigger; the schema snapshot is generated unchanged.
-- Restate all existing owner-scoped branches and add a content-free job pointer.
-- Worker lease expiry has no job write and is handled by the display refresh.
-- This is an ordinary invoker function owned by app, not SECURITY DEFINER (P3).
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
  ELSIF TG_TABLE_NAME = 'chat_jobs' THEN
    IF TG_OP = 'DELETE' THEN
      payload := jsonb_build_object('k', 'chat_jobs', 'owner',
        OLD.owner_user_id, 'chat', OLD.chat_id);
    ELSE
      payload := jsonb_build_object('k', 'chat_jobs', 'owner',
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
CREATE OR REPLACE TRIGGER chat_jobs_notify_change
  AFTER INSERT OR UPDATE OR DELETE
  ON chat_jobs
  FOR EACH ROW
  EXECUTE FUNCTION llame_notify_change();
