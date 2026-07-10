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
