CREATE TABLE "knowledge_spaces" (
	"knowledge_space_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	CONSTRAINT "knowledge_spaces_owner_user_id_unique" UNIQUE("owner_user_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "knowledge_spaces_owner_select" ON "knowledge_spaces" AS PERMISSIVE FOR SELECT TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "knowledge_spaces_owner_insert" ON "knowledge_spaces" AS PERMISSIVE FOR INSERT TO public WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "knowledge_spaces_owner_update" ON "knowledge_spaces" AS PERMISSIVE FOR UPDATE TO public USING (owner_user_id = current_setting('app.current_user_id', true)) WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "knowledge_spaces_owner_delete" ON "knowledge_spaces" AS PERMISSIVE FOR DELETE TO public USING (owner_user_id = current_setting('app.current_user_id', true));
