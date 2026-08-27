-- Hand-authored exception: Drizzle cannot express SECURITY DEFINER discovery
-- functions. The expected-document-count column is generated in the preceding
-- migration; these v2 siblings are necessary because db:provision-rls may have
-- transferred the v1 functions' ownership to app_rls, while migrations run as
-- app and app is never granted membership in the BYPASSRLS role.
--
-- Both functions use the same readiness predicate. A Chat is ready only when
-- its state belongs to the Chat, carries the current version and expected
-- document count, has a fresh indexed_at watermark for both message creation
-- and Chat updates, has exactly that many current-version rows, has no legacy
-- rows, and every current row has both locators. expected=0 is therefore a
-- legitimate ready state, while NULL remains preparation-incomplete.

CREATE FUNCTION llame_search_projection_stale_chats_v2(current_chunker_version integer, max_rows integer)
RETURNS TABLE (chat_id uuid, owner_user_id text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH chat_readiness AS (
    SELECT
      c.id,
      c.owner_user_id,
      c.updated_at,
      (
        s.chat_id IS NOT NULL
        AND s.owner_user_id = c.owner_user_id
        AND s.indexed_at IS NOT NULL
        AND s.chunker_version = current_chunker_version
        AND s.expected_document_count IS NOT NULL
        AND s.indexed_at >= coalesce(
          (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id),
          s.indexed_at
        )
        AND s.indexed_at >= c.updated_at
        AND (
          SELECT count(*)
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND d.chunker_version = current_chunker_version
        ) = s.expected_document_count
        AND NOT EXISTS (
          SELECT 1
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND (
              d.chunker_version <> current_chunker_version
              OR d.first_message_text_offset IS NULL
              OR d.last_message_text_offset_exclusive IS NULL
            )
        )
      ) AS ready
    FROM chats c
    LEFT JOIN search_chat_state s ON s.chat_id = c.id
  )
  SELECT id, owner_user_id, updated_at
  FROM chat_readiness
  WHERE NOT ready
  ORDER BY updated_at DESC
  LIMIT CASE
    WHEN max_rows IS NULL OR max_rows < 0 THEN 0
    ELSE LEAST(max_rows, 1000000)
  END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION llame_search_projection_stale_chats_v2(integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_projection_stale_chats_v2(integer, integer) TO app;--> statement-breakpoint

CREATE FUNCTION llame_search_projection_coverage_v2(current_chunker_version integer)
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
        AND s.expected_document_count IS NOT NULL
        AND s.indexed_at >= coalesce(
          (SELECT max(m.created_at) FROM messages m WHERE m.chat_id = c.id),
          s.indexed_at
        )
        AND s.indexed_at >= c.updated_at
        AND (
          SELECT count(*)
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND d.chunker_version = current_chunker_version
        ) = s.expected_document_count
        AND NOT EXISTS (
          SELECT 1
          FROM search_chat_documents d
          WHERE d.chat_id = c.id
            AND (
              d.chunker_version <> current_chunker_version
              OR d.first_message_text_offset IS NULL
              OR d.last_message_text_offset_exclusive IS NULL
            )
        )
      ) AS ready
    FROM chats c
    LEFT JOIN search_chat_state s ON s.chat_id = c.id
  ),
  chat_counts AS (
    SELECT
      count(*)::integer AS chat_count,
      count(*) FILTER (WHERE ready)::integer AS ready_chat_count,
      count(*) FILTER (WHERE NOT ready)::integer AS stale_chat_count
    FROM chat_readiness
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
REVOKE ALL ON FUNCTION llame_search_projection_coverage_v2(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION llame_search_projection_coverage_v2(integer) TO app;--> statement-breakpoint

-- app_rls executes both bodies after db:provision-rls transfers ownership.
-- This grant is already present from the original embedding migration, but
-- keeping the dependency beside the new definitions makes it explicit.
GRANT SELECT ON search_chat_documents TO app_rls;--> statement-breakpoint
