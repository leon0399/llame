-- Hand-appended after Drizzle generation (pattern P1 in
-- apps/api/src/db/AGENTS.md): `.enableRLS()` emits ENABLE only, and FORCE is
-- load-bearing in the single-role self-hosted deployment where the serving
-- role also owns the tables — without it every owner policy below is bypassed.
-- Regenerating this migration MUST re-add these four statements.
CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"executor_id" text NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"parent_checkout_id" uuid,
	"branch" text,
	"origin" text NOT NULL,
	"worktree_base" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_owner_id_key" UNIQUE("owner_user_id","id"),
	CONSTRAINT "checkouts_kind_check" CHECK ("checkouts"."kind" IN ('main', 'worktree')),
	CONSTRAINT "checkouts_origin_check" CHECK ("checkouts"."origin" IN ('registered', 'adopted', 'created')),
	CONSTRAINT "checkouts_worktree_parent_check" CHECK (("checkouts"."kind" = 'worktree') = ("checkouts"."parent_checkout_id" IS NOT NULL)),
	CONSTRAINT "checkouts_worktree_base_check" CHECK ("checkouts"."kind" = 'main' OR "checkouts"."worktree_base" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "checkouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"canonical_remote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_owner_id_key" UNIQUE("owner_user_id","id")
);
--> statement-breakpoint
ALTER TABLE "repositories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repository_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"canonical_alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worktree_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"base_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worktree_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_repository_owner_fk" FOREIGN KEY ("owner_user_id","repository_id") REFERENCES "public"."repositories"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_parent_owner_fk" FOREIGN KEY ("owner_user_id","parent_checkout_id") REFERENCES "public"."checkouts"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_aliases" ADD CONSTRAINT "repository_aliases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_aliases" ADD CONSTRAINT "repository_aliases_repository_owner_fk" FOREIGN KEY ("owner_user_id","repository_id") REFERENCES "public"."repositories"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_leases" ADD CONSTRAINT "worktree_leases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_leases" ADD CONSTRAINT "worktree_leases_checkout_owner_fk" FOREIGN KEY ("owner_user_id","checkout_id") REFERENCES "public"."checkouts"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktree_leases" ADD CONSTRAINT "worktree_leases_chat_owner_fk" FOREIGN KEY ("chat_id","owner_user_id") REFERENCES "public"."chats"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_owner_executor_path_uidx" ON "checkouts" USING btree ("owner_user_id","executor_id","path");--> statement-breakpoint
CREATE INDEX "checkouts_owner_repository_idx" ON "checkouts" USING btree ("owner_user_id","repository_id");--> statement-breakpoint
CREATE INDEX "checkouts_owner_parent_idx" ON "checkouts" USING btree ("owner_user_id","parent_checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_owner_canonical_remote_uidx" ON "repositories" USING btree ("owner_user_id","canonical_remote");--> statement-breakpoint
CREATE INDEX "repositories_owner_created_idx" ON "repositories" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_aliases_owner_alias_uidx" ON "repository_aliases" USING btree ("owner_user_id","canonical_alias");--> statement-breakpoint
CREATE INDEX "repository_aliases_owner_repository_idx" ON "repository_aliases" USING btree ("owner_user_id","repository_id");--> statement-breakpoint
CREATE INDEX "worktree_leases_owner_checkout_idx" ON "worktree_leases" USING btree ("owner_user_id","checkout_id");--> statement-breakpoint
CREATE INDEX "worktree_leases_owner_chat_idx" ON "worktree_leases" USING btree ("owner_user_id","chat_id");--> statement-breakpoint
CREATE POLICY "checkouts_owner" ON "checkouts" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "repositories_owner" ON "repositories" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "repository_aliases_owner" ON "repository_aliases" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "worktree_leases_owner" ON "worktree_leases" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));

--> statement-breakpoint
ALTER TABLE "repositories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_aliases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worktree_leases" FORCE ROW LEVEL SECURITY;
