-- Pre-alpha schema replacement: tool_observation_ledger becomes required
-- replacement_history with no backfill. Reset and re-migrate disposable DBs.
-- Do not reset or migrate the maintainer database without explicit agreement.
-- Rollback is unsupported after the first replacement_history write.
ALTER TABLE "compactions" ADD COLUMN "replacement_history" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compactions" DROP COLUMN "tool_observation_ledger";
