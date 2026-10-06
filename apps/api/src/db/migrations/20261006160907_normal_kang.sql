ALTER TYPE "public"."message_role" ADD VALUE 'checkpoint';--> statement-breakpoint
DROP POLICY "compactions_owner" ON "compactions" CASCADE;--> statement-breakpoint
DROP TABLE "compactions" CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "absorbed_through_seq" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_chat_absorbed_through_seq_uidx" ON "messages" USING btree ("chat_id","absorbed_through_seq") WHERE "messages"."absorbed_through_seq" IS NOT NULL;--> statement-breakpoint
ALTER POLICY "messages_public_read" ON "messages" TO public USING (current_setting('app.current_user_id', true) = '' AND chat_id IN (SELECT id FROM chats WHERE visibility = 'public') AND role::text <> 'checkpoint');
-- MANUAL MIGRATION NOTE: drizzle-kit emits ENABLE but cannot express FORCE.
-- Restore FORCE so the tenant table remains isolated when the app role owns it.
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint