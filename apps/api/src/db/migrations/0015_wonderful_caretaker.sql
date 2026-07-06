CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_name_slug" CHECK ("prompts"."name" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "prompts_content_len" CHECK (char_length("prompts"."content") BETWEEN 1 AND 8000)
);
--> statement-breakpoint
ALTER TABLE "prompts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_user_name_idx" ON "prompts" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE POLICY "prompts_owner" ON "prompts" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.current_user_id', true));