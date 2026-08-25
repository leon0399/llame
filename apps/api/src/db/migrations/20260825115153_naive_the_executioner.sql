ALTER TABLE "compactions" ADD COLUMN "replacement_history" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compactions" DROP COLUMN "tool_observation_ledger";