# apps/api/src/db

Schema, migrations, and RLS. Read `apps/api/src/db/AGENTS.md`.

Flag every one of these: a new tenant-bearing table whose migration does not hand-append
`FORCE ROW LEVEL SECURITY` (Drizzle's `.enableRLS()` emits ENABLE only); a data backfill
not wrapped in a `NO FORCE ROW LEVEL SECURITY` window (migrations run as `app` with no
`app.current_user_id`, so under FORCE the write silently affects zero rows and a later
`SET NOT NULL` or `USING` cast fails); a `CREATE OR REPLACE` on a `SECURITY DEFINER`
function that `db:provision-rls` may already have reassigned to `app_rls` (add a new
sibling function instead); a `SECURITY DEFINER` function returning content rather than
identifiers and counts; a hand-authored step lacking a `.sql` header comment; a journal
`when` that does not sort last.
