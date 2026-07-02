-- Hand-authored (#73, like 0004/0006 — Drizzle cannot express triggers).
--
-- DB-level in_reply_to integrity: the plain FK only proves the target message
-- EXISTS; nothing stopped a future code path from linking a reply to a message
-- in another chat (threading corruption across a tenant's chats) or to a
-- non-user message. findTurnState enforces both in-app; this trigger makes the
-- invariant hold against any writer.
--
-- Runs under the caller's RLS context: the referenced message is in the same
-- chat as the row being written, so it is visible to the same tenant.
CREATE FUNCTION assert_message_reply_integrity() RETURNS trigger AS $$
BEGIN
  IF NEW.in_reply_to IS NOT NULL THEN
    PERFORM 1
    FROM messages m
    WHERE m.id = NEW.in_reply_to
      AND m.chat_id = NEW.chat_id
      AND m.role = 'user';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'in_reply_to must reference a user message in the same chat'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER messages_reply_integrity
  BEFORE INSERT OR UPDATE OF in_reply_to, chat_id ON messages
  FOR EACH ROW EXECUTE FUNCTION assert_message_reply_integrity();
