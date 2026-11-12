ALTER TABLE "runs" ADD COLUMN "wake_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "current_job_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "awaiting" jsonb;