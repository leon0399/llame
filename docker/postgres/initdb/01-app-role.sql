-- Runs ONCE, on a fresh data volume, as the `postgres` superuser, connected to `llame`.
--
-- Creates the role the application connects as. It is deliberately:
--   - NOT a superuser and NOT BYPASSRLS (either would bypass Row-Level Security), and
--   - the OWNER of the database and the `public` schema.
--
-- Because migrations run as `app`, every table is owned by `app`; combined with
-- `FORCE ROW LEVEL SECURITY` (migration 0004) this means RLS is enforced against the
-- app role itself — the worst case for a single-role self-hosted deployment. Dev thus
-- exercises the exact isolation guarantee production relies on (#53).
--
-- Dev-only credentials; do not reuse anywhere real.
CREATE ROLE app WITH LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

ALTER DATABASE llame OWNER TO app;
ALTER SCHEMA public OWNER TO app;
GRANT ALL ON SCHEMA public TO app;
