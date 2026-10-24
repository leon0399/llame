CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"isolation" text DEFAULT 'inherit' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_repositories_owner_id_key" UNIQUE("owner_user_id","id"),
	CONSTRAINT "project_repositories_isolation_check" CHECK ("project_repositories"."isolation" IN ('inherit', 'always_worktree', 'never'))
);
--> statement-breakpoint
ALTER TABLE "project_repositories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-moved: the composite owner foreign key below references
-- (owner_user_id, id) on projects, and Postgres requires the referenced unique
-- constraint to exist before the FOREIGN KEY statement runs. Drizzle emits the
-- ADD CONSTRAINT after the foreign keys whenever the table already exists, so
-- the projects key is created here, first.
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_key" UNIQUE("owner_user_id","id");--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_owner_fk" FOREIGN KEY ("owner_user_id","project_id") REFERENCES "public"."projects"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_repository_owner_fk" FOREIGN KEY ("owner_user_id","repository_id") REFERENCES "public"."repositories"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_owner_project_repository_uidx" ON "project_repositories" USING btree ("owner_user_id","project_id","repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_owner_project_primary_uidx" ON "project_repositories" USING btree ("owner_user_id","project_id") WHERE "project_repositories"."is_primary";--> statement-breakpoint
CREATE INDEX "project_repositories_owner_project_idx" ON "project_repositories" USING btree ("owner_user_id","project_id");--> statement-breakpoint
CREATE INDEX "project_repositories_owner_repository_idx" ON "project_repositories" USING btree ("owner_user_id","repository_id");--> statement-breakpoint
CREATE POLICY "project_repositories_owner" ON "project_repositories" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true) AND project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true))) WITH CHECK (owner_user_id = current_setting('app.current_user_id', true) AND project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true)));

--> statement-breakpoint
-- Hand-appended: Drizzle only emits ENABLE ROW LEVEL SECURITY, never FORCE. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "project_repositories" FORCE ROW LEVEL SECURITY;
