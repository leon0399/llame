-- Migration: v0.1 multi-tenant chat + message schema (issue #53)
--
-- Drops the PoC chats + messages tables and recreates them with:
--   - chats.owner_user_id (replaces user_id) + visibility + updatedAt
--   - messages: uuid primary key, role enum, senderUserId (nullable), parts (jsonb),
--     attachments (jsonb), createdAt with timezone
--   - Row-Level Security on both tables
--   - Indexes: (owner_user_id, updated_at) on chats, (chat_id, created_at) on messages
--
-- MANUAL MIGRATION NOTE: drizzle-kit generate requires interactive TTY input to
-- resolve column rename ambiguity (user_id → owner_user_id). Since this is a
-- full table replacement rather than a rename, this migration was hand-authored
-- to correctly DROP and recreate both tables. The Drizzle schema in
-- src/db/schema/chats.ts is authoritative and matches this SQL exactly.
--
-- The app DB role must NOT be BYPASSRLS or a superuser. Each request must run:
--   SET LOCAL app.current_user_id = '<user-id>';
-- inside a transaction before any chats/messages query.

-- Drop PoC tables (messages first to satisfy FK)
DROP TABLE IF EXISTS "messages";
--> statement-breakpoint
DROP TABLE IF EXISTS "chats";
--> statement-breakpoint

-- New message_role enum
DO $$ BEGIN
  CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- chats: multi-tenant, owner-scoped
CREATE TABLE "chats" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id"  text NOT NULL,
  "title"          text NOT NULL DEFAULT 'New chat',
  "visibility"     varchar NOT NULL DEFAULT 'private',
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- messages: AI SDK v5 UIMessage shape, sender-attributed
CREATE TABLE "messages" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chat_id"         uuid NOT NULL,
  "role"            "message_role" NOT NULL,
  "sender_user_id"  text,
  "parts"           jsonb NOT NULL,
  "attachments"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Foreign keys
ALTER TABLE "chats" ADD CONSTRAINT "chats_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk"
  FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk"
  FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- Indexes
CREATE INDEX "chats_owner_updated_idx" ON "chats" ("owner_user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "messages_chat_created_idx" ON "messages" ("chat_id", "created_at");
--> statement-breakpoint

-- Row-Level Security
-- ENABLE turns RLS on; FORCE makes it apply to the table OWNER too. Without FORCE,
-- a self-hosted deployment that runs the app on the same Postgres role that owns
-- (and migrates) these tables would silently bypass RLS entirely — the moat would
-- be off even with `app.current_user_id` set. FORCE closes that. (Superusers and
-- BYPASSRLS roles still bypass RLS regardless — the app role must be neither.)
ALTER TABLE "chats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS policy: chats visible only to their owner
-- Uses text = text comparison (owner_user_id is text, matching users.id which is text)
CREATE POLICY "chats_owner" ON "chats"
  USING (owner_user_id = current_setting('app.current_user_id', true));
--> statement-breakpoint

-- RLS policy: messages visible only when their chat is owned by the current user
CREATE POLICY "messages_owner" ON "messages"
  USING (
    chat_id IN (
      SELECT id FROM chats
      WHERE owner_user_id = current_setting('app.current_user_id', true)
    )
  );
