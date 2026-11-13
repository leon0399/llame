CREATE TABLE "chat_creation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_creation_records_attempts_check" CHECK (jsonb_typeof("chat_creation_records"."attempts") = 'array')
);
--> statement-breakpoint
ALTER TABLE "chat_creation_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_repository_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"project_repository_id" uuid NOT NULL,
	"executor_id" text NOT NULL,
	"checkout_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_repository_defaults" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_executor_id" text;--> statement-breakpoint
ALTER TABLE "chat_creation_records" ADD CONSTRAINT "chat_creation_records_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_creation_records" ADD CONSTRAINT "chat_creation_records_chat_owner_fk" FOREIGN KEY ("chat_id","owner_user_id") REFERENCES "public"."chats"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_defaults" ADD CONSTRAINT "project_repository_defaults_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_defaults" ADD CONSTRAINT "project_repository_defaults_link_owner_fk" FOREIGN KEY ("owner_user_id","project_repository_id") REFERENCES "public"."project_repositories"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_defaults" ADD CONSTRAINT "project_repository_defaults_checkout_owner_fk" FOREIGN KEY ("owner_user_id","checkout_id") REFERENCES "public"."checkouts"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_creation_records_owner_chat_uidx" ON "chat_creation_records" USING btree ("owner_user_id","chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repository_defaults_owner_link_executor_uidx" ON "project_repository_defaults" USING btree ("owner_user_id","project_repository_id","executor_id");--> statement-breakpoint
CREATE INDEX "project_repository_defaults_owner_link_idx" ON "project_repository_defaults" USING btree ("owner_user_id","project_repository_id");--> statement-breakpoint
CREATE INDEX "project_repository_defaults_owner_checkout_idx" ON "project_repository_defaults" USING btree ("owner_user_id","checkout_id");--> statement-breakpoint
CREATE POLICY "chat_creation_records_owner" ON "chat_creation_records" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "project_repository_defaults_owner" ON "project_repository_defaults" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true) AND project_repository_id IN (SELECT id FROM project_repositories WHERE owner_user_id = current_setting('app.current_user_id', true))) WITH CHECK (owner_user_id = current_setting('app.current_user_id', true) AND project_repository_id IN (SELECT id FROM project_repositories WHERE owner_user_id = current_setting('app.current_user_id', true)));
--> statement-breakpoint
-- Hand-appended: Drizzle only emits ENABLE ROW LEVEL SECURITY, never FORCE. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "chat_creation_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_repository_defaults" FORCE ROW LEVEL SECURITY;
