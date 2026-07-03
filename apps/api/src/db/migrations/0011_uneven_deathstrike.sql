CREATE TYPE "public"."run_status" AS ENUM('queued', 'resolving_config', 'retrieving_context', 'planning', 'waiting_for_approval', 'running_model', 'running_tool', 'running_sandbox', 'updating_artifact', 'summarizing', 'completed', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "run_events" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "run_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"message_id" uuid,
	"user_id" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"worker_id" text,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-reordered: the composite FKs below require these unique indexes to exist
-- first (drizzle-kit emits FKs before indexes). Re-apply if regenerated.
CREATE UNIQUE INDEX "chats_id_owner_user_id_unique_idx" ON "chats" USING btree ("id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_id_chat_id_unique_idx" ON "messages" USING btree ("id","chat_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_chat_id_user_id_fk" FOREIGN KEY ("chat_id","user_id") REFERENCES "public"."chats"("id","owner_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_message_id_chat_id_fk" FOREIGN KEY ("message_id","chat_id") REFERENCES "public"."messages"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_events_run_sequence_idx" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "runs_chat_created_idx" ON "runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_user_status_idx" ON "runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE POLICY "run_events_owner_select" ON "run_events" AS PERMISSIVE FOR SELECT TO public USING (run_id IN (
        SELECT runs.id FROM runs
        INNER JOIN chats ON chats.id = runs.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "run_events_owner_insert" ON "run_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (run_id IN (
        SELECT runs.id FROM runs
        INNER JOIN chats ON chats.id = runs.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "runs_owner" ON "runs" AS PERMISSIVE FOR ALL TO public USING (chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      ));-- Hand-maintained (like 0004/0009): Drizzle's .enableRLS() emits ENABLE only. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_events" FORCE ROW LEVEL SECURITY;
