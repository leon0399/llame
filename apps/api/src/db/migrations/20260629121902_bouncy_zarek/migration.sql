CREATE TYPE "public"."chat_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "visibility" SET DEFAULT 'private'::"public"."chat_visibility";--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "visibility" SET DATA TYPE "public"."chat_visibility" USING "visibility"::"public"."chat_visibility";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "messages_chat_seq_idx" ON "messages" USING btree ("chat_id","seq");