CREATE TYPE "public"."pin_item_type" AS ENUM('chat', 'project');--> statement-breakpoint
CREATE TABLE "pins" (
	"user_id" text NOT NULL,
	"item_type" "pin_item_type" NOT NULL,
	"item_id" uuid NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pins_user_id_item_type_item_id_pk" PRIMARY KEY("user_id","item_type","item_id")
);
--> statement-breakpoint
ALTER TABLE "pins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE ROW LEVEL SECURITY is hand-appended (Drizzle emits ENABLE only): the
-- single-role self-hosted case needs FORCE so the table-owning `app` role does
-- not bypass RLS. Same as 0004 (chats), 0011 (runs), 0018 (org-units), 0021
-- (projects). Re-add if this migration is regenerated.
ALTER TABLE "pins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "chats_owner_pinned_updated_idx";--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pins_user_pinned_idx" ON "pins" USING btree ("user_id","pinned_at" DESC NULLS LAST,"item_id");--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "pinned_at";--> statement-breakpoint
CREATE POLICY "pins_owner_select" ON "pins" AS PERMISSIVE FOR SELECT TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "pins_owner_delete" ON "pins" AS PERMISSIVE FOR DELETE TO public USING (user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "pins_owner_insert" ON "pins" AS PERMISSIVE FOR INSERT TO public WITH CHECK (user_id = current_setting('app.current_user_id', true) AND (
        (item_type = 'chat' AND item_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true)))
        OR (item_type = 'project' AND item_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true)))
      ));