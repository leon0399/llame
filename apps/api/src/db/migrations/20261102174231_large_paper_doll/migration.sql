CREATE TABLE "tool_artifact_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"line_count" integer NOT NULL,
	"findings" jsonb
);
--> statement-breakpoint
ALTER TABLE "tool_artifact_parts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tool_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"tool_name" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"complete" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_artifacts_chat_seq_unique" UNIQUE("chat_id","seq"),
	CONSTRAINT "tool_artifacts_chat_run_call_unique" UNIQUE("chat_id","run_id","tool_call_id")
);
--> statement-breakpoint
ALTER TABLE "tool_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "artifact_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_artifact_parts" ADD CONSTRAINT "tool_artifact_parts_artifact_id_tool_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."tool_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_artifacts" ADD CONSTRAINT "tool_artifacts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_artifact_parts_artifact_idx" ON "tool_artifact_parts" USING btree ("artifact_id");--> statement-breakpoint
CREATE POLICY "tool_artifact_parts_owner_select" ON "tool_artifact_parts" AS PERMISSIVE FOR SELECT TO public USING (artifact_id IN (
        SELECT tool_artifacts.id FROM tool_artifacts
        INNER JOIN chats ON chats.id = tool_artifacts.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "tool_artifact_parts_owner_insert" ON "tool_artifact_parts" AS PERMISSIVE FOR INSERT TO public WITH CHECK (artifact_id IN (
        SELECT tool_artifacts.id FROM tool_artifacts
        INNER JOIN chats ON chats.id = tool_artifacts.chat_id
        WHERE chats.owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "tool_artifacts_owner_select" ON "tool_artifacts" AS PERMISSIVE FOR SELECT TO public USING (chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      ));--> statement-breakpoint
CREATE POLICY "tool_artifacts_owner_insert" ON "tool_artifacts" AS PERMISSIVE FOR INSERT TO public WITH CHECK (chat_id IN (
        SELECT id FROM chats
        WHERE owner_user_id = current_setting('app.current_user_id', true)
      ));
--> statement-breakpoint
-- Hand-appended: Drizzle only emits ENABLE ROW LEVEL SECURITY, never FORCE. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add if this migration is ever regenerated.
ALTER TABLE "tool_artifacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tool_artifact_parts" FORCE ROW LEVEL SECURITY;
