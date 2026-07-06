CREATE TYPE "public"."todo_source" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."todo_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"content" text NOT NULL,
	"status" "todo_status" DEFAULT 'pending' NOT NULL,
	"source" "todo_source" DEFAULT 'agent' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todos_content_len" CHECK (char_length("todos"."content") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "todos_chat_source_position_idx" ON "todos" USING btree ("chat_id","source","position");--> statement-breakpoint
CREATE POLICY "todos_owner" ON "todos" AS PERMISSIVE FOR ALL TO public USING (EXISTS (
        SELECT 1 FROM chats c
        WHERE c.id = "todos"."chat_id"
          AND c.owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
-- FORCE is hand-appended (Drizzle can't express it) — load-bearing for the
-- single-role self-hosted case. Re-add if regenerating (see AGENTS.md gotchas).
ALTER TABLE "todos" FORCE ROW LEVEL SECURITY;