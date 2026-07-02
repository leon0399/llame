CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_content_len" CHECK (char_length("memories"."content") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- FORCE is hand-appended (Drizzle can't express it) — load-bearing for the
-- single-role self-hosted case so the table owner can't bypass RLS. Re-add if
-- regenerating (see gotchas + 0009/0010/0017/0018/0019/0022).
ALTER TABLE "memories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_user_created_idx" ON "memories" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE POLICY "memories_owner" ON "memories" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.current_user_id', true));