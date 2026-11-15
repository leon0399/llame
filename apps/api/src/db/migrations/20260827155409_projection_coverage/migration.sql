-- Hand-authored exception: Drizzle cannot express SECURITY DEFINER discovery
-- functions. These functions are deliberately new siblings rather than
-- CREATE OR REPLACE on llame_search_stale_chats: db:provision-rls may already
-- have transferred that function's ownership to app_rls, while migrations run
-- as app and app is never granted membership in the BYPASSRLS role.
--
-- The stale sibling adds locator completeness to the existing lexical
-- discovery contract. The aggregate sibling is the operator cutover readout;
-- it contains no Chat IDs, owner IDs, message content, or embedding fields.

CREATE FUNCTION llame_search_projection_stale_chats(current_chunker_version integer, max_rows integer)
RETURNS TABLE (chat_id uuid, owner_user_id text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.owner_user_id, c.updated_at
  FROM chats c
  LEFT JOIN search_chat_state s ON s.chat_id = c.id
  WHERE s.chat_id IS NULL
     OR s.owner_user_id IS DISTINCT FROM c.owner_user_id
     OR s.chunker_version <> current_chunker_version
     OR s.indexed_at IS NULL
     OR s.indexed_at < (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id)
     OR s.indexed_at < c.updated_at
     OR EXISTS (
       SELECT 1
       FROM search_chat_documents d
       WHERE d.chat_id = c.id
         AND d.owner_user_id IS DISTINCT FROM c.owner_user_id
     )
     OR EXISTS (
       SELECT 1
       FROM search_chat_documents d
       WHERE d.chat_id = c.id
         AND d.owner_user_id = c.owner_user_id
         AND (
           d.chunker_version <> current_chunker_version
           OR d.first_message_text_offset IS NULL
           OR d.last_message_text_offset_exclusive IS NULL
         )
     )
     OR EXISTS (
       SELECT 1
       FROM search_chat_documents d
       WHERE d.chat_id = c.id
         AND d.owner_user_id = c.owner_user_id
         AND d.chunker_version = current_chunker_version
         AND (
           NOT EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.id = d.first_message_id
               AND m.chat_id = c.id
           )
           OR NOT EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.id = d.last_message_id
               AND m.chat_id = c.id
           )
         )
     )
  ORDER BY c.updated_at DESC
  LIMIT CASE
    WHEN max_rows < 0 THEN 0
    ELSE LEAST(max_rows, 1000000)
  END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION llame_search_projection_stale_chats(integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_projection_stale_chats(integer, integer) TO app;--> statement-breakpoint

CREATE FUNCTION llame_search_projection_coverage(current_chunker_version integer)
RETURNS TABLE (
  chunker_version integer,
  chat_count integer,
  ready_chat_count integer,
  stale_chat_count integer,
  document_count integer,
  complete_document_count integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH chat_readiness AS (
    SELECT
      c.id,
      (
        s.chat_id IS NOT NULL
        AND s.owner_user_id = c.owner_user_id
        AND s.indexed_at IS NOT NULL
        AND s.chunker_version = current_chunker_version
        AND s.indexed_at >= coalesce(
          (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id),
          s.indexed_at
        )
        AND s.indexed_at >= c.updated_at
        AND NOT EXISTS (
          SELECT 1
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND d.owner_user_id = c.owner_user_id
            AND (
              d.chunker_version <> current_chunker_version
              OR d.first_message_text_offset IS NULL
              OR d.last_message_text_offset_exclusive IS NULL
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND d.owner_user_id IS DISTINCT FROM c.owner_user_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND d.owner_user_id = c.owner_user_id
            AND d.chunker_version = current_chunker_version
            AND (
              NOT EXISTS (
                SELECT 1
                FROM messages m
                WHERE m.id = d.first_message_id
                  AND m.chat_id = c.id
              )
              OR NOT EXISTS (
                SELECT 1
                FROM messages m
                WHERE m.id = d.last_message_id
                  AND m.chat_id = c.id
              )
            )
        )
      ) AS ready
    FROM chats c
    LEFT JOIN search_chat_state s ON s.chat_id = c.id
  ),
  document_counts AS (
    SELECT
      count(*)::integer AS document_count,
      count(*) FILTER (
        WHERE d.chunker_version = current_chunker_version
          AND d.first_message_text_offset IS NOT NULL
          AND d.last_message_text_offset_exclusive IS NOT NULL
      )::integer AS complete_document_count
    FROM search_chat_documents d
  ),
  chat_counts AS (
    SELECT
      count(*)::integer AS chat_count,
      count(*) FILTER (WHERE ready)::integer AS ready_chat_count,
      count(*) FILTER (WHERE NOT ready)::integer AS stale_chat_count
    FROM chat_readiness
  )
  SELECT
    current_chunker_version,
    chat_counts.chat_count,
    chat_counts.ready_chat_count,
    chat_counts.stale_chat_count,
    document_counts.document_count,
    document_counts.complete_document_count
  FROM chat_counts
  CROSS JOIN document_counts;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION llame_search_projection_coverage(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_projection_coverage(integer) TO app;--> statement-breakpoint

-- app_rls executes both functions' bodies after db:provision-rls transfers
-- ownership. This grant is already present from the embedding migration, but
-- keeping the dependency beside the new SQL makes fresh and upgraded schemas
-- equally explicit and is idempotent.
GRANT SELECT ON search_chat_documents TO app_rls;--> statement-breakpoint
