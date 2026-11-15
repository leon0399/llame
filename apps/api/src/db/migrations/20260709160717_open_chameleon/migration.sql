-- runs.model_id. drizzle-kit emits only ADD COLUMN + SET NOT NULL, so a manual
-- UPDATE backfills existing rows to the canonical default before SET NOT NULL,
-- inside a NO FORCE ROW LEVEL SECURITY window (pattern P2, same as 0012).
-- Without the window the backfill silently no-ops and SET NOT NULL fails.
-- Re-add the window and the backfill if this migration is regenerated.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "model_id" text;
-- Hand-authored backfill (like 0012): FORCE RLS would silently no-op this
-- update because migrations run as the owning `app` role with no
-- app.current_user_id, and FORCE subjects even the owner to policies. Lift
-- FORCE for the backfill window and restore it immediately after; the owner
-- bypasses plain RLS, and no non-migration statement runs in between.
ALTER TABLE "runs" NO FORCE ROW LEVEL SECURITY;
UPDATE "runs" SET "model_id" = 'system:openai:gpt-5.4-mini' WHERE "model_id" IS NULL;
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "runs" ALTER COLUMN "model_id" SET NOT NULL;
