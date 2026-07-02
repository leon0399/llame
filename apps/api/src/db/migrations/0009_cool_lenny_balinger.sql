CREATE TABLE "compactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"upto_seq" bigint NOT NULL,
	"parent_id" uuid,
	"summary" text NOT NULL,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compactions" ADD CONSTRAINT "compactions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compactions" ADD CONSTRAINT "compactions_parent_id_compactions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."compactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compactions_chat_upto_seq_idx" ON "compactions" USING btree ("chat_id","upto_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "compactions_id_chat_id_unique_idx" ON "compactions" USING btree ("id","chat_id");--> statement-breakpoint
ALTER TABLE "compactions" ADD CONSTRAINT "compactions_parent_id_chat_id_fk" FOREIGN KEY ("parent_id","chat_id") REFERENCES "public"."compactions"("id","chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "compactions_owner" ON "compactions" AS PERMISSIVE FOR ALL TO public USING (chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
-- Hand-maintained (like 0004): Drizzle's .enableRLS() emits ENABLE only. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "compactions" FORCE ROW LEVEL SECURITY;
