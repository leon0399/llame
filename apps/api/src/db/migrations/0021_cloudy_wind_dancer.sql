CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_project_idx" ON "chats" USING btree ("project_id");--> statement-breakpoint
CREATE POLICY "projects_owner" ON "projects" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
ALTER POLICY "chats_owner" ON "chats" TO public USING (owner_user_id = current_setting('app.current_user_id', true)) WITH CHECK (owner_user_id = current_setting('app.current_user_id', true) AND (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true))));--> statement-breakpoint
-- Hand-appended: Drizzle only emits ENABLE ROW LEVEL SECURITY, never FORCE. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;