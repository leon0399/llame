CREATE TYPE "public"."todo_source" AS ENUM('user', 'agent');--> statement-breakpoint
DROP INDEX "todos_chat_position_idx";--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "source" "todo_source" DEFAULT 'agent' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "todos_chat_source_position_idx" ON "todos" USING btree ("chat_id","source","position");