-- Coordinated destructive cutover: model_context_snapshots is replaced by the
-- system-only attempt receipt and the minimal committed-turn availability
-- observation. This migration is hand-authored because the data backfill must
-- run with RLS temporarily unfenced and must distinguish observed v1 manifests
-- from the historical unobserved sentinel. The migration remains transactional;
-- rerunning its guarded backfill and IF EXISTS/IF NOT EXISTS DDL is harmless.

DO $migration$
BEGIN
  -- The old table is absent on a rerun after a successful cutover. Keep the
  -- backfill conditional so the migration remains deterministic and idempotent.
  IF to_regclass('public.model_context_snapshots') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "runs" NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE "model_context_snapshots" NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE "system_prompt_receipts" NO FORCE ROW LEVEL SECURITY;

  -- Historical attempts have no trustworthy queue retry count or dispatch
  -- timestamp. Derive a stable UUID solely from the run identity.
  INSERT INTO "system_prompt_receipts" (
    "id",
    "owner_user_id",
    "run_id",
    "attempt_id",
    "source",
    "system_prompt",
    "prompt_hash",
    "created_at"
  )
  SELECT
    md5('llame:model-context:historical-receipt:v1:' || r."id"::text)::uuid,
    r."user_id",
    r."id",
    md5('llame:model-context:historical-attempt:v1:' || r."id"::text)::uuid,
    s."source",
    s."system_prompt",
    s."prompt_hash",
    s."created_at"
  FROM "runs" AS r
  INNER JOIN "model_context_snapshots" AS s
    ON s."id" = r."model_context_snapshot_id"
   AND s."owner_user_id" = r."user_id"
  ON CONFLICT ("owner_user_id", "run_id", "attempt_id") DO NOTHING;

  -- A pre-attempt run has no winning identity. Use the same explicit historical
  -- identity as the receipt, but never overwrite a newer completed attempt.
  UPDATE "runs" AS r
  SET "completed_attempt_id" =
    md5('llame:model-context:historical-attempt:v1:' || r."id"::text)::uuid
  WHERE r."model_context_snapshot_id" IS NOT NULL
    AND r."status" = 'completed'
    AND r."completed_attempt_id" IS NULL;

  -- Only a v1 entries array is an observed availability. Version 0's
  -- {state:"unobserved"} sentinel is intentionally excluded; malformed and
  -- failed rows remain NULL. An observed empty entries array becomes [].
  UPDATE "runs" AS r
  SET "turn_tool_availability" = COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('id', entry->>'id', 'state', entry->>'state')
        ORDER BY entry->>'id'
      )
      FROM jsonb_array_elements(
        s."tool_availability_manifest"->'entries'
      ) AS entries(entry)
      WHERE entry->>'id' IS NOT NULL
        AND entry->>'state' IN ('available', 'unavailable')
    ),
    '[]'::jsonb
  )
  FROM "model_context_snapshots" AS s
  WHERE s."id" = r."model_context_snapshot_id"
    AND s."owner_user_id" = r."user_id"
    AND r."status" = 'completed'
    AND r."turn_tool_availability" IS NULL
    AND s."tool_availability_manifest"->>'version' = '1'
    AND jsonb_typeof(s."tool_availability_manifest"->'entries') = 'array';

  ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;
  ALTER TABLE "model_context_snapshots" FORCE ROW LEVEL SECURITY;
  ALTER TABLE "system_prompt_receipts" FORCE ROW LEVEL SECURITY;
END
$migration$;--> statement-breakpoint

-- The owner-matching FK needs a unique composite target on runs. Keep this
-- index after the snapshot drop because receipts continue to use it.
CREATE UNIQUE INDEX IF NOT EXISTS "runs_id_user_id_unique_idx"
  ON "runs" USING btree ("id", "user_id");--> statement-breakpoint

DO $migration$
BEGIN
  -- Drop and re-add so a prior NO ACTION version converges on rerun.
  ALTER TABLE "system_prompt_receipts"
    DROP CONSTRAINT IF EXISTS "system_prompt_receipts_run_id_user_id_fk";
  ALTER TABLE "system_prompt_receipts"
    ADD CONSTRAINT "system_prompt_receipts_run_id_user_id_fk"
    FOREIGN KEY ("run_id", "owner_user_id")
    REFERENCES "public"."runs" ("id", "user_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
END
$migration$;--> statement-breakpoint

ALTER TABLE "runs"
  DROP CONSTRAINT IF EXISTS "runs_model_context_snapshot_id_user_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "runs_model_context_snapshot_idx";--> statement-breakpoint
ALTER TABLE "runs"
  DROP COLUMN IF EXISTS "model_context_snapshot_id";--> statement-breakpoint
DROP TABLE IF EXISTS "model_context_snapshots" CASCADE;
