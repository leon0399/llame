-- Alpha hard-cutover preflight. Migrations run as the FORCE-constrained table
-- owner with no tenant identity, so the three global scans need scoped windows.
ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_events" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compactions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "messages" AS m
    CROSS JOIN LATERAL jsonb_array_elements(m."parts") AS part(value)
    WHERE part.value ->> 'type' = 'tool-conversation_read'
       OR (
         part.value ->> 'type' = 'tool-search_conversations'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(part.value -> 'output' -> 'results') = 'array'
                 THEN part.value -> 'output' -> 'results'
               ELSE '[]'::jsonb
             END
           ) AS result(value)
           WHERE result.value ? 'messageSeq'
         )
       )
  ) OR EXISTS (
    SELECT 1
    FROM "run_events" AS event
    WHERE event."payload" ->> 'toolName' = 'conversation_read'
       OR (
         event."payload" ->> 'toolName' = 'search_conversations'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(event."payload" -> 'output' -> 'results') = 'array'
                 THEN event."payload" -> 'output' -> 'results'
               ELSE '[]'::jsonb
             END
           ) AS result(value)
           WHERE result.value ? 'messageSeq'
         )
       )
  ) OR EXISTS (
    SELECT 1
    FROM "compactions" AS c
    CROSS JOIN LATERAL jsonb_array_elements(c."replacement_history") AS history(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(history.value -> 'parts') = 'array'
          THEN history.value -> 'parts'
        ELSE '[]'::jsonb
      END
    ) AS part(value)
    WHERE part.value ->> 'type' = 'tool-conversation_read'
       OR (
         part.value ->> 'type' = 'tool-search_conversations'
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(part.value -> 'output' -> 'results') = 'array'
                 THEN part.value -> 'output' -> 'results'
               ELSE '[]'::jsonb
             END
           ) AS result(value)
           WHERE result.value ? 'messageSeq'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Chat-local sequence cutover refused: persisted experimental global conversation locators exist';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "run_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Rewrite message and compaction boundaries in one transaction. Both unique
-- indexes are temporarily absent so old and new values cannot collide mid-update.
CREATE TEMP TABLE message_sequence_mapping (
  message_id uuid PRIMARY KEY,
  chat_id uuid NOT NULL,
  old_seq bigint NOT NULL,
  new_seq bigint NOT NULL,
  UNIQUE (chat_id, old_seq),
  UNIQUE (chat_id, new_seq)
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO message_sequence_mapping (message_id, chat_id, old_seq, new_seq)
SELECT
  id,
  chat_id,
  seq,
  row_number() OVER (PARTITION BY chat_id ORDER BY seq)
FROM "messages";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "compactions" AS c
    LEFT JOIN message_sequence_mapping AS mapping
      ON mapping.chat_id = c.chat_id
     AND mapping.old_seq = c.upto_seq
    WHERE mapping.message_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Chat-local sequence cutover refused: compaction boundary has no source message';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "messages_chat_seq_unique_idx";--> statement-breakpoint
DROP INDEX "compactions_chat_upto_seq_idx";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "seq" DROP IDENTITY;--> statement-breakpoint
UPDATE "compactions" AS c
SET "upto_seq" = mapping.new_seq
FROM message_sequence_mapping AS mapping
WHERE mapping.chat_id = c.chat_id
  AND mapping.old_seq = c.upto_seq;--> statement-breakpoint
UPDATE "messages" AS m
SET "seq" = mapping.new_seq
FROM message_sequence_mapping AS mapping
WHERE mapping.message_id = m.id;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_chat_seq_unique_idx" ON "messages" USING btree ("chat_id", "seq");--> statement-breakpoint
CREATE UNIQUE INDEX "compactions_chat_upto_seq_idx" ON "compactions" USING btree ("chat_id", "upto_seq");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_seq_positive" CHECK ("messages"."seq" > 0);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "messages"
    GROUP BY chat_id
    HAVING min(seq) <> 1
       OR max(seq) <> count(*)
       OR count(DISTINCT seq) <> count(*)
  ) THEN
    RAISE EXCEPTION 'Chat-local sequence cutover failed density verification';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "compactions" AS c
    LEFT JOIN message_sequence_mapping AS mapping
      ON mapping.chat_id = c.chat_id
     AND mapping.new_seq = c.upto_seq
    WHERE mapping.message_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Chat-local sequence cutover failed compaction verification';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN ('messages'::regclass, 'run_events'::regclass, 'compactions'::regclass)
      AND NOT relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Chat-local sequence cutover failed to restore FORCE ROW LEVEL SECURITY';
  END IF;
END
$$;
