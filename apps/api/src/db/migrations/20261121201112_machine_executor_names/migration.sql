-- Hand-authored Machine executor-id migration (host-as-machine D5): Drizzle
-- cannot express a data transformation. Forward-only; a rollback restores a
-- database backup.
--
-- Why: every executor id becomes a Machine name, so a stored `machine:<name>`
-- loses its prefix and a host id keeps its value. Every stored Workspace root
-- becomes a canonical `machine://<name>/<path>` locator (design D6), so a
-- result, a binding, and a permission rule compare equal as strings.
--
-- Rewritten columns: `chats.workspace_executor_id`, `chats.workspace_root`,
-- `chats.workspace_told` (the D10 `<machine>` newline `<root>` form),
-- `checkouts.executor_id`, `checkouts.path`, `checkouts.worktree_base`,
-- `project_repository_defaults.executor_id`, `projects.default_executor_id`,
-- and `chat_creation_records.attempts[].worktreeDirectory`.
--
-- History stays as it was: `run_events` and message parts describe turns whose
-- paths were reported at the time, and the other `chat_creation_records`
-- fields (its path decisions) are that same history. `runs.worker_id` keeps
-- its value because a host id is unchanged (D15).
--
-- A `chats` row with no executor id keeps a bare Workspace root: there is no
-- Machine name to build a locator from, and the app treats such a binding as
-- absent at its next attempt. A told value without an executor id becomes
-- NULL, which costs one extra snapshot.
--
-- Migrations run as `app` without a tenant identity while these tables are
-- FORCE RLS, so every guard and every update below runs with FORCE lifted
-- (apps/api/src/db/AGENTS.md P2). The path encoder is a `pg_temp` function:
-- temporary objects are transaction-scoped, so it can neither leak below nor
-- fail a retry, and it is dropped explicitly at the end anyway.
ALTER TABLE "chats" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkouts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_repository_defaults" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_creation_records" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Percent-encode exactly what `encodeLocatorPath` in
-- src/tools/permissions/locator-path.ts encodes: `%` first so `%XX` stays
-- literal text after one decode, the literals `#`, `?`, and `\`, C0 controls
-- and DEL, and a `:` after the last `/` (which a read-selector split would
-- otherwise claim). Everything else, including a `:` in a middle segment, is
-- kept.
CREATE FUNCTION pg_temp.machine_locator_path_encode(path text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  encoded text := '';
  last_separator integer := 0;
  letter_index integer;
  letter text;
BEGIN
  FOR letter_index IN REVERSE length(path)..1 LOOP
    IF substr(path, letter_index, 1) = '/' THEN
      last_separator := letter_index;
      EXIT;
    END IF;
  END LOOP;

  FOR letter_index IN 1..length(path) LOOP
    letter := substr(path, letter_index, 1);

    IF letter = '%' THEN
      encoded := encoded || '%25';
    ELSIF letter = '#' THEN
      encoded := encoded || '%23';
    ELSIF letter = '?' THEN
      encoded := encoded || '%3F';
    ELSIF letter = '\' THEN
      encoded := encoded || '%5C';
    ELSIF letter = ':' AND letter_index > last_separator THEN
      encoded := encoded || '%3A';
    ELSIF ascii(letter) <= 31 OR ascii(letter) = 127 THEN
      encoded := encoded
        || '%'
        || upper(lpad(to_hex(ascii(letter)), 2, '0'));
    ELSE
      encoded := encoded || letter;
    END IF;
  END LOOP;

  RETURN encoded;
END
$$;--> statement-breakpoint
-- A kept value must still be a Machine name, or the row would name an executor
-- that no configuration can ever reach. Fail here, naming the column and the
-- value, rather than leaving a half-rewritten database: the transaction rolls
-- back and nothing changes.
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT 'chats.workspace_executor_id' AS column_name,
           workspace_executor_id AS value
      FROM chats
     WHERE workspace_executor_id IS NOT NULL
       AND regexp_replace(workspace_executor_id, '^machine:', '', 'i')
           !~ '^[a-z0-9-]{1,63}$'
    UNION ALL
    SELECT 'checkouts.executor_id', executor_id
      FROM checkouts
     WHERE regexp_replace(executor_id, '^machine:', '', 'i')
           !~ '^[a-z0-9-]{1,63}$'
    UNION ALL
    SELECT 'project_repository_defaults.executor_id', executor_id
      FROM project_repository_defaults
     WHERE regexp_replace(executor_id, '^machine:', '', 'i')
           !~ '^[a-z0-9-]{1,63}$'
    UNION ALL
    SELECT 'projects.default_executor_id', default_executor_id
      FROM projects
     WHERE default_executor_id IS NOT NULL
       AND regexp_replace(default_executor_id, '^machine:', '', 'i')
           !~ '^[a-z0-9-]{1,63}$'
  LOOP
    RAISE EXCEPTION
      'machine executor id migration: % holds %, which is not a Machine name',
      offender.column_name, offender.value;
  END LOOP;
END
$$;--> statement-breakpoint
-- Stripping a prefix can merge two rows that one of the two unique keys keeps
-- apart today: `machine:nas` and `nas` are distinct ids before this migration
-- and the same id after it. Compare the REWRITTEN tuples (path and worktree
-- base included) so the failure names the key instead of surfacing later as an
-- opaque unique violation halfway through the rewrite.
DO $$
DECLARE
  collision record;
BEGIN
  SELECT owner_user_id,
         regexp_replace(executor_id, '^machine:', '', 'i') AS executor_id,
         CASE
           WHEN path LIKE '/%'
             THEN 'machine://'
               || regexp_replace(executor_id, '^machine:', '', 'i')
               || pg_temp.machine_locator_path_encode(path)
           ELSE path
         END AS path
    INTO collision
    FROM checkouts
   GROUP BY 1, 2, 3
  HAVING count(*) > 1
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'machine executor id migration: rows would collide on checkouts_owner_executor_path_uidx (%, %, %)',
      collision.owner_user_id, collision.executor_id, collision.path;
  END IF;

  SELECT owner_user_id,
         project_repository_id,
         regexp_replace(executor_id, '^machine:', '', 'i') AS executor_id
    INTO collision
    FROM project_repository_defaults
   GROUP BY 1, 2, 3
  HAVING count(*) > 1
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'machine executor id migration: rows would collide on project_repository_defaults_owner_link_executor_uidx (%, %, %)',
      collision.owner_user_id,
      collision.project_repository_id,
      collision.executor_id;
  END IF;
END
$$;--> statement-breakpoint
UPDATE "chats"
SET "workspace_executor_id" = regexp_replace("workspace_executor_id", '^machine:', '', 'i')
WHERE "workspace_executor_id" ~* '^machine:';--> statement-breakpoint
UPDATE "checkouts"
SET "executor_id" = regexp_replace("executor_id", '^machine:', '', 'i')
WHERE "executor_id" ~* '^machine:';--> statement-breakpoint
UPDATE "project_repository_defaults"
SET "executor_id" = regexp_replace("executor_id", '^machine:', '', 'i')
WHERE "executor_id" ~* '^machine:';--> statement-breakpoint
UPDATE "projects"
SET "default_executor_id" = regexp_replace("default_executor_id", '^machine:', '', 'i')
WHERE "default_executor_id" ~* '^machine:';--> statement-breakpoint
-- The executor id is already stripped here, so the root names the Machine by
-- that same id.
UPDATE "chats"
SET "workspace_root" = 'machine://'
  || "workspace_executor_id"
  || pg_temp.machine_locator_path_encode("workspace_root")
WHERE "workspace_root" LIKE '/%'
  AND "workspace_executor_id" IS NOT NULL;--> statement-breakpoint
-- A resend reads `worktreeDirectory` back, so an absolute value must name the
-- Machine too. The Machine is the attempt's SOURCE CHECKOUT — the path its
-- first decision recorded — not the record's Chat: a create that crashed or
-- ended `outcome_unknown` before binding has no Chat executor, yet its
-- directory still lives on the Machine whose checkout it came from, and a
-- resend reads that directory back. This runs before `checkouts.path` is
-- rewritten, so the join compares the bare source path an old record stored
-- with the bare checkout row. An attempt whose source path matches no checkout,
-- or matching rows on more than one Machine (the same clone path on two
-- Machines), keeps its value as written.
UPDATE "chat_creation_records" AS "record"
SET "attempts" = (
  SELECT jsonb_agg(
    CASE
      WHEN entry.attempt->>'worktreeDirectory' LIKE '/%'
        AND source.executor_id IS NOT NULL
        THEN jsonb_set(
          entry.attempt,
          '{worktreeDirectory}',
          to_jsonb(
            'machine://'
            || source.executor_id
            || pg_temp.machine_locator_path_encode(
              entry.attempt->>'worktreeDirectory'
            )
          )
        )
      ELSE entry.attempt
    END
    ORDER BY entry.ordinality
  )
  FROM jsonb_array_elements("record"."attempts")
    WITH ORDINALITY AS entry(attempt, ordinality)
  LEFT JOIN LATERAL (
    SELECT min("checkout"."executor_id") AS "executor_id"
      FROM "checkouts" AS "checkout"
     WHERE "checkout"."owner_user_id" = "record"."owner_user_id"
       AND "checkout"."path" = entry.attempt->'decisions'->0->>'path'
    HAVING count(DISTINCT "checkout"."executor_id") = 1
  ) AS "source" ON true
)
WHERE jsonb_array_length("record"."attempts") > 0;--> statement-breakpoint
UPDATE "checkouts"
SET "path" = 'machine://'
  || "executor_id"
  || pg_temp.machine_locator_path_encode("path")
WHERE "path" LIKE '/%';--> statement-breakpoint
UPDATE "checkouts"
SET "worktree_base" = 'machine://'
  || "executor_id"
  || pg_temp.machine_locator_path_encode("worktree_base")
WHERE "worktree_base" LIKE '/%';--> statement-breakpoint
-- The told value is rewritten from itself, not from the current root: the root
-- may have been re-bound after the snapshot was told, and the told text is what
-- the next attempt compares against.
UPDATE "chats"
SET "workspace_told" = CASE
  WHEN "workspace_executor_id" IS NULL THEN NULL
  WHEN "workspace_told" LIKE '/%'
    THEN "workspace_executor_id"
      || E'\n'
      || 'machine://'
      || "workspace_executor_id"
      || pg_temp.machine_locator_path_encode("workspace_told")
  ELSE "workspace_executor_id" || E'\n' || "workspace_told"
END
WHERE "workspace_told" IS NOT NULL;--> statement-breakpoint
DROP FUNCTION pg_temp.machine_locator_path_encode(text);--> statement-breakpoint
ALTER TABLE "chats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_repository_defaults" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_creation_records" FORCE ROW LEVEL SECURITY;
