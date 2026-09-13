-- Manual: adoption projection (#154 complete-owner-forks, design D8).
--
-- Projects every retained actual Run/snapshot/message relationship into
-- message_turn_contexts, captures each Chat's current state in its
-- immutable initialContinuationState, and sets the Chat's contextRevision
-- to the adoption value.
--
-- Requires coordinated API/worker quiescence: no acceptance or compaction
-- transaction should be in flight while this runs, or the captured state
-- could miss a concurrent write. This is a one-time adoption, not a
-- repeatable sync. No production chat reset or destructive operation.
--
-- Owner-copy rollback floor: once a complete fork exists, the minimum
-- compatible runtime includes the owner-copy consumer changes. The
-- history-state layer alone is not a rollback target.
--
-- P2 pattern: FORCED RLS prevents migration-time writes without tenant
-- identity. Temporarily disable FORCE for the backfill, then re-enable.
-- Re-add FORCE statements if this migration is regenerated.

-- Step 1: Disable FORCE RLS on tables we're reading from and writing to.
ALTER TABLE "message_turn_contexts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chats" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compactions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Step 2: Project existing Run evidence into message_turn_contexts.
-- Each Run with a message becomes one evidence record. Runs without a
-- messageId are skipped (orphaned execution records). contextRevision is
-- assigned per-Chat in acceptance order (createdAt, id) starting at 1.
-- sourceMaxSeq is the triggering user message's seq.
-- Companion state columns are NULL — genuinely absent historical state.
-- ON CONFLICT DO NOTHING makes this idempotent for reruns.
INSERT INTO "message_turn_contexts" (
  "chat_id",
  "origin_run_id",
  "message_id",
  "owner_user_id",
  "model_id",
  "effort",
  "accepted_at",
  "snapshot_id",
  "context_revision",
  "source_max_seq",
  "context_items",
  "created_at"
)
SELECT
  r."chat_id",
  r."id",
  r."message_id",
  r."user_id",
  r."model_id",
  r."effort",
  COALESCE(r."created_at", NOW()),
  r."model_context_snapshot_id",
  ROW_NUMBER() OVER (
    PARTITION BY r."chat_id"
    ORDER BY r."created_at", r."id"
  ),
  m."seq",
  r."context_items",
  COALESCE(r."created_at", NOW())
FROM "runs" r
INNER JOIN "messages" m ON m."id" = r."message_id" AND m."chat_id" = r."chat_id"
WHERE r."message_id" IS NOT NULL
ON CONFLICT ("chat_id", "origin_run_id") DO NOTHING;--> statement-breakpoint

-- The adoption sourceMaxSeq is COALESCE(MAX(messages.seq), 0), including
-- unfinished rows. contextRevision is set to one past the highest
-- projected evidence revision (or 1 for empty chats).
WITH chat_state AS (
  SELECT
    c."id" AS "chat_id",
    COALESCE(msg."max_seq", 0) AS "max_seq",
    COALESCE(proj."max_revision", 0) AS "max_revision",
    latest_comp."id" AS "latest_compaction_id",
    c."recency_digest_baseline",
    c."recency_digest_told",
    c."recency_digest_rebaked_from"
  FROM "chats" c
  LEFT JOIN (
    SELECT "chat_id", MAX("seq") AS "max_seq"
    FROM "messages"
    GROUP BY "chat_id"
  ) msg ON msg."chat_id" = c."id"
  LEFT JOIN (
    SELECT "chat_id", MAX("context_revision") AS "max_revision"
    FROM "message_turn_contexts"
    GROUP BY "chat_id"
  ) proj ON proj."chat_id" = c."id"
  LEFT JOIN LATERAL (
    SELECT "id"
    FROM "compactions"
    WHERE "chat_id" = c."id"
    ORDER BY "upto_seq" DESC
    LIMIT 1
  ) latest_comp ON true
)
UPDATE "chats" SET
  "initial_continuation_state" = jsonb_build_object(
    'contextRevision', cs."max_revision" + 1,
    'sourceMaxSeq', cs."max_seq",
    'digestBaseline', cs."recency_digest_baseline",
    'digestTold', cs."recency_digest_told"
  ),
  "context_revision" = cs."max_revision" + 1,
  "initial_active_compaction_id" = cs."latest_compaction_id",
  "initial_digest_rebaked_from" = CASE
    WHEN cs."recency_digest_rebaked_from" IS NOT NULL
     AND cs."latest_compaction_id" IS NOT NULL
     AND cs."recency_digest_rebaked_from" = cs."latest_compaction_id"
    THEN cs."recency_digest_rebaked_from"
    ELSE NULL
  END
FROM chat_state cs
WHERE "chats"."id" = cs."chat_id";--> statement-breakpoint

-- NOTE: the CTE above uses FROM chats with LEFT JOINs, so every chat
-- (including those with zero messages) receives its initial state. No
-- separate empty-chat fallback is needed.

-- Step 4: Re-enable FORCE RLS.
ALTER TABLE "message_turn_contexts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
