CREATE TABLE "chat_job_chunks" (
	"job_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"output" text NOT NULL,
	"position" integer NOT NULL,
	"content" "bytea" NOT NULL,
	CONSTRAINT "chat_job_chunks_pk" PRIMARY KEY("job_id","output","position")
);
--> statement-breakpoint
ALTER TABLE "chat_job_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"executor" text NOT NULL,
	"seq" integer NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"stopped_by" text,
	"run_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"worker_instance_id" uuid NOT NULL,
	"pid" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"stop_requested_at" timestamp with time zone,
	"stop_requested_by" text,
	"result" jsonb,
	"outputs" text[] DEFAULT '{}'::text[] NOT NULL,
	"artifact_id" uuid,
	"artifact_readable" boolean DEFAULT false NOT NULL,
	"settings" jsonb NOT NULL,
	CONSTRAINT "chat_jobs_chat_executor_seq_unique" UNIQUE("chat_id","executor","seq"),
	CONSTRAINT "chat_jobs_id_owner_unique" UNIQUE("id","owner_user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "worker_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_job_chunks" ADD CONSTRAINT "chat_job_chunks_job_id_owner_user_id_fk" FOREIGN KEY ("job_id","owner_user_id") REFERENCES "public"."chat_jobs"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_artifact_id_tool_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."tool_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_chat_id_owner_user_id_fk" FOREIGN KEY ("chat_id","owner_user_id") REFERENCES "public"."chats"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_jobs_chat_running_idx" ON "chat_jobs" USING btree ("chat_id") WHERE state = 'running';--> statement-breakpoint
CREATE POLICY "chat_job_chunks_owner" ON "chat_job_chunks" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "chat_jobs_owner" ON "chat_jobs" AS PERMISSIVE FOR ALL TO public USING (owner_user_id = current_setting('app.current_user_id', true));--> statement-breakpoint
-- Hand-appended: Drizzle only emits ENABLE ROW LEVEL SECURITY, never FORCE. FORCE is
-- load-bearing for the single-role self-hosted case — without it the table owner
-- bypasses RLS. Re-add both if this migration is ever regenerated.
ALTER TABLE "chat_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_job_chunks" FORCE ROW LEVEL SECURITY;
