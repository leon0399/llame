CREATE TABLE "memory_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"share_recent_chats" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "memory_settings_owner_select" ON "memory_settings" AS PERMISSIVE FOR SELECT TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "memory_settings_owner_insert" ON "memory_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "memory_settings_owner_update" ON "memory_settings" AS PERMISSIVE FOR UPDATE TO public USING (user_id = current_setting('app.current_user_id', true)) WITH CHECK (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "memory_settings_owner_delete" ON "memory_settings" AS PERMISSIVE FOR DELETE TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
ALTER TABLE "memory_settings" FORCE ROW LEVEL SECURITY;
