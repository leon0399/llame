-- Hand-authored quota-wait backfill: Drizzle cannot express a JSONB transformation.
-- Existing non-null `runs.awaiting` values are awaiting_jobs waits. Tag them so
-- the new tagged union can distinguish job waits from quota waits. Migrations
-- run as `app` without an owner identity; `runs` is FORCE RLS, so lift FORCE
-- for this statement only or the update silently matches zero rows.
ALTER TABLE "runs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "runs"
SET "awaiting" = jsonb_set("awaiting", '{kind}', '"jobs"'::jsonb, true)
WHERE "awaiting" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;