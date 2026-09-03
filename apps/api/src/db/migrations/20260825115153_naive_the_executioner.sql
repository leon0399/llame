-- Compaction replacement-history HARD CUTOVER. Drops
-- compactions.tool_observation_ledger and adds required
-- compactions.replacement_history. There is no legacy reader, fallback, dual
-- writer, or backfill.
-- BEFORE APPLYING TO THE MAINTAINER DATABASE: obtain maintainer agreement and
-- stop every API process, including legacy readers. Keep compatible workers
-- running until accepted Runs drain or are explicitly terminated, then stop
-- them and wait for in-flight compaction writes to settle. Using a superuser or
-- a BYPASSRLS role with SELECT on runs and compactions, verify both tables are
-- empty before applying the schema and application revisions together.
-- Rollback is unsupported after the first replacement_history write; there is
-- no reverse conversion into tool_observation_ledger.
-- Operator SQL: docs/scaling.md#compaction-replacement-history-hard-cutover
ALTER TABLE "compactions" ADD COLUMN "replacement_history" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compactions" DROP COLUMN "tool_observation_ledger";
