-- Bind legacy rows to a synthetic daemon identity; running work is unknowable after the cutover, and the chunk table is intentionally dropped without copying.
DROP POLICY "chat_job_chunks_owner" ON "chat_job_chunks";--> statement-breakpoint
DROP TABLE "chat_job_chunks";--> statement-breakpoint
ALTER TABLE "chat_jobs" RENAME COLUMN "executor" TO "kind";--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD COLUMN "machine_name" text;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD COLUMN "daemon_instance_id" text;--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD COLUMN "daemon_job_id" text;--> statement-breakpoint
ALTER TABLE "chat_jobs" DROP COLUMN "worker_instance_id";--> statement-breakpoint
ALTER TABLE "chat_jobs" DROP COLUMN "pid";--> statement-breakpoint
ALTER TABLE "chat_jobs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "chat_jobs" SET "machine_name" = 'host', "daemon_instance_id" = 'legacy', "daemon_job_id" = replace("id"::text, '-', ''), "state" = CASE WHEN "state" = 'running' THEN 'lost' ELSE "state" END, "result" = CASE WHEN "state" = 'running' THEN jsonb_build_object('outcomeUnknown', true, 'cause', 'daemon_restarted') ELSE "result" END, "settled_at" = CASE WHEN "state" = 'running' THEN now() ELSE "settled_at" END;--> statement-breakpoint
ALTER TABLE "chat_jobs" ALTER COLUMN "machine_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_jobs" ALTER COLUMN "daemon_instance_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_jobs" ALTER COLUMN "daemon_job_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_jobs" RENAME CONSTRAINT "chat_jobs_chat_executor_seq_unique" TO "chat_jobs_chat_kind_seq_unique";--> statement-breakpoint
ALTER TABLE "chat_jobs" ADD CONSTRAINT "chat_jobs_daemon_instance_job_unique" UNIQUE("daemon_instance_id","daemon_job_id");