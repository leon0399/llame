ALTER TABLE "runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
-- Hand-authored backfill (like 0006/0010): the partial unique index below cannot
-- be created while multiple non-terminal runs share a chat. Cancel all but the
-- newest per chat first. Re-add if this migration is ever regenerated.
WITH "cancelled_runs" AS (
  UPDATE "runs"
  SET
    "status" = 'cancelled',
    "finished_at" = COALESCE("finished_at", now()),
    "error" = COALESCE(
      "error",
      '{"message":"Cancelled by single-flight migration: superseded by newer non-terminal run."}'::jsonb
    )
  WHERE "id" IN (
    SELECT "id"
    FROM (
      SELECT
        "id",
        row_number() OVER (
          PARTITION BY "chat_id"
          ORDER BY "created_at" DESC, "id" DESC
        ) AS "rn"
      FROM "runs"
      WHERE "status" NOT IN ('completed', 'failed', 'cancelled', 'expired')
    ) "ranked_runs"
    WHERE "rn" > 1
  )
  RETURNING "id"
)
-- Terminal transitions append their run.<status> event (RunEventType
-- invariant) — historical rows the backfill cancels get theirs too.
INSERT INTO "run_events" ("run_id", "event_type", "payload")
SELECT
  "id",
  'run.cancelled',
  '{"reason":"superseded by newer non-terminal run (single-flight migration)"}'::jsonb
FROM "cancelled_runs";--> statement-breakpoint
CREATE UNIQUE INDEX "runs_chat_inflight_unique" ON "runs" USING btree ("chat_id") WHERE status NOT IN ('completed', 'failed', 'cancelled', 'expired');