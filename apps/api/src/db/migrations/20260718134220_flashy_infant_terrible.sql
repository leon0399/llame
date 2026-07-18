CREATE TYPE "public"."model_context_prompt_source" AS ENUM('project_default', 'model_override');--> statement-breakpoint
CREATE TABLE "model_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"tool_hash" text NOT NULL,
	"source" "model_context_prompt_source" NOT NULL,
	"system_prompt" text NOT NULL,
	"tool_declarations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model_context_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "model_context_snapshots" ADD CONSTRAINT "model_context_snapshots_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_context_snapshots_id_owner_user_id_unique_idx" ON "model_context_snapshots" USING btree ("id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_context_snapshots_owner_content_source_unique_idx" ON "model_context_snapshots" USING btree ("owner_user_id","content_hash","source");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_model_context_snapshot_id_user_id_fk" FOREIGN KEY ("model_context_snapshot_id","user_id") REFERENCES "public"."model_context_snapshots"("id","owner_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_model_context_snapshot_idx" ON "runs" USING btree ("model_context_snapshot_id");--> statement-breakpoint
CREATE POLICY "model_context_snapshots_owner_select" ON "model_context_snapshots" AS PERMISSIVE FOR SELECT TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "model_context_snapshots_owner_insert" ON "model_context_snapshots" AS PERMISSIVE FOR INSERT TO public WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
-- Hand-appended after Drizzle generation: `.enableRLS()` emits ENABLE only.
-- FORCE is load-bearing when the application role also owns the table.
ALTER TABLE "model_context_snapshots" FORCE ROW LEVEL SECURITY;
