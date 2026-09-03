-- Compaction replacement-history HARD CUTOVER. Drops
-- compactions.tool_observation_ledger and adds required
-- compactions.replacement_history. There is no legacy reader, fallback, dual
-- writer, or backfill.
-- BEFORE APPLYING TO THE MAINTAINER DATABASE: obtain maintainer agreement and
-- verify a pre-migration snapshot. With co-located workers, quiesce Chat sends
-- and drain/terminate accepted Runs before stopping processes. With dedicated
-- workers, stop web APIs, drain Runs, then stop workers. After processes exit
-- and compaction writes settle, use a superuser or BYPASSRLS role with SELECT
-- on both tables to verify zero nonterminal Runs and zero compaction rows.
-- Rollback is unsupported after the first replacement_history write; there is
-- no reverse conversion into tool_observation_ledger.
-- Operator SQL: docs/scaling.md#compaction-replacement-history-hard-cutover
ALTER TABLE "compactions" ADD COLUMN "replacement_history" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compactions" DROP COLUMN "tool_observation_ledger";
