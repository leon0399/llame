-- Hand-authored model-selection migration (model-roles). drizzle-kit emits the
-- four column adds but cannot express the data steps, and its emitted
-- `ADD COLUMN "selector" text NOT NULL` fails on any database that already
-- holds Runs, so the column is added nullable and tightened after the backfill.
--
-- Every rewrite below sits inside a NO FORCE ROW LEVEL SECURITY window
-- (apps/api/src/db/AGENTS.md P2): migrations run as the owning `app` role with
-- no `app.current_user_id`, so under FORCE both the UPDATE targets and the
-- `runs` subquery `chats` reads silently match zero rows. FORCE is restored on
-- all four tables before the NOT NULL is imposed. Regeneration must restore the
-- nullable add, the backfills, the ordering, and the restore statements.
--
-- 1. `runs.selector` / `runs.selected_effort`: a pre-feature Run's selector was
--    exactly the model it called, and its selected effort was the effort it
--    sent. `WHERE selector IS NULL` keeps a re-run from touching an
--    already-admitted Run. Only then does `selector` become NOT NULL.
-- 2. `chats.model_selection`: one seeded selection per Chat, revision 1, taken
--    from the Chat's latest TURN Run (`created_at`, then `id`, break ties). A
--    Chat with no turn Run — never sent, or compaction only — stays NULL, which
--    admission reads as "use `defaults.selector`". The `IS NULL` guard keeps a
--    re-run from overwriting a selection written since the column existed.
-- 3. `chat_deliveries.settings` and `chat_jobs.settings`: the pending-item and
--    job settings key `modelId` becomes `selector`. Only the key moves; every
--    other key keeps its value, and the `? 'modelId'` guard makes a re-run a
--    no-op.
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "model_selection" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "selector" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "selected_effort" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "selection_revision" integer;--> statement-breakpoint
ALTER TABLE "chats" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_deliveries" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_jobs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "runs"
SET "selector" = "model_id",
    "selected_effort" = "effort"
WHERE "selector" IS NULL;--> statement-breakpoint
UPDATE "chats"
SET "model_selection" = jsonb_build_object(
  'revision', 1,
  'selector', "latest_turn"."model_id",
  'effort', "latest_turn"."effort"
)
FROM (
  SELECT DISTINCT ON ("chat_id") "chat_id", "model_id", "effort"
  FROM "runs"
  WHERE "kind" = 'turn'
  ORDER BY "chat_id", "created_at" DESC, "id" DESC
) AS "latest_turn"
WHERE "chats"."id" = "latest_turn"."chat_id"
  AND "chats"."model_selection" IS NULL;--> statement-breakpoint
UPDATE "chat_deliveries"
SET "settings" = ("settings" - 'modelId')
  || jsonb_build_object('selector', "settings"->'modelId')
WHERE "settings" ? 'modelId';--> statement-breakpoint
UPDATE "chat_jobs"
SET "settings" = ("settings" - 'modelId')
  || jsonb_build_object('selector', "settings"->'modelId')
WHERE "settings" ? 'modelId';--> statement-breakpoint
ALTER TABLE "chats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "selector" SET NOT NULL;
