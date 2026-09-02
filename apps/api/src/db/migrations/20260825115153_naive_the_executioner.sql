-- Compaction replacement-history HARD CUTOVER. Drops
-- compactions.tool_observation_ledger and adds required
-- compactions.replacement_history. There is no legacy reader, fallback, dual
-- writer, or backfill.
-- BEFORE APPLYING: quiesce API writers, keep compatible workers running, drain
-- or explicitly terminate every accepted nonterminal Run, then use an
-- administrative BYPASSRLS/superuser connection to verify zero nonterminal Runs
-- and zero compaction rows. The normal `app` role CANNOT perform that global
-- check under FORCE RLS — without app.current_user_id its reads are denied and
-- a false zero is possible. Stop workers only after both checks pass; apply
-- schema and application revisions together.
-- ROLLBACK: stop new authoring, drain accepted Runs with compatible workers,
-- stop workers, then roll back schema and binaries.
-- Operator SQL: docs/scaling.md#compaction-replacement-history-hard-cutover
ALTER TABLE "compactions" ADD COLUMN "replacement_history" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compactions" DROP COLUMN "tool_observation_ledger";