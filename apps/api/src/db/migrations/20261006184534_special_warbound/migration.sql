-- Checkpoint rows replace the compactions table. This file is generated
-- except for the final FORCE statement: drizzle-kit emits ENABLE but cannot
-- express FORCE ROW LEVEL SECURITY, so the tenant messages table keeps it
-- explicitly and regeneration must re-append it (src/db/AGENTS.md P1).
ALTER TYPE "public"."message_role" ADD VALUE 'checkpoint';--> statement-breakpoint
DROP POLICY "compactions_owner" ON "compactions" CASCADE;--> statement-breakpoint
DROP TABLE "compactions" CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "absorbed_through_seq" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_chat_absorbed_through_seq_uidx" ON "messages" USING btree ("chat_id","absorbed_through_seq") WHERE "messages"."absorbed_through_seq" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_checkpoint_boundary_check" CHECK (("messages"."role"::text = 'checkpoint') = ("messages"."absorbed_through_seq" IS NOT NULL));--> statement-breakpoint
ALTER POLICY "messages_public_read" ON "messages" TO public USING (current_setting('app.current_user_id', true) = '' AND chat_id IN (SELECT id FROM chats WHERE visibility = 'public') AND role::text <> 'checkpoint');--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
