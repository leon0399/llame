-- Pre-alpha schema replacement: tool_observation_ledger becomes required
-- replacement_history with no backfill. Reset and re-migrate disposable DBs.
ALTER TABLE "compactions" ADD COLUMN "replacement_history" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compactions" DROP COLUMN "tool_observation_ledger";
