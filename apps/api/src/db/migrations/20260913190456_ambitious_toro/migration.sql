CREATE TABLE "system_prompt_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"source" "model_context_prompt_source" NOT NULL,
	"system_prompt" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_prompt_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_prompt_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "turn_tool_availability" jsonb;--> statement-breakpoint
ALTER TABLE "system_prompt_receipts" ADD CONSTRAINT "system_prompt_receipts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "system_prompt_receipts_owner_run_attempt_uidx" ON "system_prompt_receipts" USING btree ("owner_user_id","run_id","attempt_id");--> statement-breakpoint
CREATE POLICY "system_prompt_receipts_owner_select" ON "system_prompt_receipts" AS PERMISSIVE FOR SELECT TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "system_prompt_receipts_owner_insert" ON "system_prompt_receipts" AS PERMISSIVE FOR INSERT TO public WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));