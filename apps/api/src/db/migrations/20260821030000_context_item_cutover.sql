-- Hand-authored: strip the retired context-part shapes from messages.parts.
--
-- `data-model-context`, `data-tool-availability`, and `data-recency-digest`
-- are superseded by one `data-context` part. No compatibility layer is
-- retained, and no instance holds history worth carrying through the
-- boundary, so the legacy parts are DELETED rather than reshaped. The
-- consequence is accepted rather than glossed: a chat predating this cutover
-- loses its context parts, so its model-switch boundary stops rendering in
-- the transcript, and rolling back restores the code path but not the rows.
--
-- drizzle-kit cannot express a jsonb array filter, and this is data rather
-- than schema, so it is hand-authored and recorded in apps/api/AGENTS.md's
-- migration exception ledger.
--
-- The UPDATE runs inside a NO FORCE ROW LEVEL SECURITY window for the same
-- reason as 0012/0020/0022: migrations run as the owning `app` role with no
-- `app.current_user_id`, and `messages` is FORCE RLS, so without the window
-- every policy denies and the update silently no-ops.
ALTER TABLE "messages" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

UPDATE "messages"
SET "parts" = COALESCE(
  (
    SELECT jsonb_agg(part ORDER BY ordinality)
    FROM jsonb_array_elements("parts") WITH ORDINALITY AS elements(part, ordinality)
    WHERE part->>'type' IS DISTINCT FROM 'data-model-context'
      AND part->>'type' IS DISTINCT FROM 'data-tool-availability'
      AND part->>'type' IS DISTINCT FROM 'data-recency-digest'
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements("parts") AS elements(part)
  WHERE part->>'type' IN (
    'data-model-context',
    'data-tool-availability',
    'data-recency-digest'
  )
);--> statement-breakpoint

ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
