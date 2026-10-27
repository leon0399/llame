ALTER TABLE "runs" ADD COLUMN "follow_up_action" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_source_run_id_user_id_fk" FOREIGN KEY ("source_run_id","user_id") REFERENCES "public"."runs"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_follow_up_action_check" CHECK ("runs"."follow_up_action" IS NULL OR "runs"."follow_up_action" IN ('continue', 'regenerate'));