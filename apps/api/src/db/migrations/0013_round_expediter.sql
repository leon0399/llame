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
);--> statement-breakpoint
CREATE UNIQUE INDEX "runs_chat_inflight_unique" ON "runs" USING btree ("chat_id") WHERE status NOT IN ('completed', 'failed', 'cancelled', 'expired');
