-- Historical assistant usage completeness is derived from persisted parts,
-- status, and prompt receipts. Drizzle cannot generate this data backfill or
-- its RLS-owner window. The NOT-complete guard keeps reruns safe and preserves
-- existing keys and values.
ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_prompt_receipts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "messages" AS message
SET "usage" = message."usage" || jsonb_build_object(
  'complete',
  CASE
    WHEN message."usage"->>'status' IS DISTINCT FROM 'completed'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(message."parts") AS part(value)
        WHERE part.value->>'type' LIKE 'tool-%'
      )
      OR (
        SELECT COUNT(DISTINCT receipt."attempt_id") > 1
        FROM "system_prompt_receipts" AS receipt
        WHERE receipt."run_id"::text = message."usage"->>'runId'
      )
    THEN false
    ELSE true
  END
)
WHERE message."role" = 'assistant'
  AND jsonb_typeof(message."usage") = 'object'
  AND NOT (message."usage" ? 'complete');--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_prompt_receipts" FORCE ROW LEVEL SECURITY;