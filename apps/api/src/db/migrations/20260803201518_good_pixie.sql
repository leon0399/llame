CREATE TABLE "personalization" (
	"user_id" text PRIMARY KEY NOT NULL,
	"preferred_name" text,
	"about" text,
	"response_preferences" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"share_account_identity" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personalization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "personalization" ADD CONSTRAINT "personalization_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "personalization_owner_select" ON "personalization" AS PERMISSIVE FOR SELECT TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "personalization_owner_insert" ON "personalization" AS PERMISSIVE FOR INSERT TO public WITH CHECK (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "personalization_owner_update" ON "personalization" AS PERMISSIVE FOR UPDATE TO public USING (user_id = current_setting('app.current_user_id', true)) WITH CHECK (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "personalization_owner_delete" ON "personalization" AS PERMISSIVE FOR DELETE TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
-- HAND-APPENDED (add-user-personalization). Drizzle's `.enableRLS()` emits only
-- ENABLE; without FORCE the table OWNER bypasses every policy above, and `app`
-- owns every table in a self-hosted single-role deployment — so the isolation
-- would be silently absent exactly where it matters. Same exception as
-- chats/0004, runs/0011, org-units/0018, projects/0021, pins/0023.
-- Re-add this statement if this migration is ever regenerated.
ALTER TABLE "personalization" FORCE ROW LEVEL SECURITY;