#!/usr/bin/env bash
#
# Prove the multi-tenant RLS moat (#53) against a real Postgres.
#
# Spins up a throwaway Postgres in docker, creates a NON-superuser role `app` that
# OWNS the schema (the worst case for a self-hosted single-role deployment), applies
# all migrations as that role, then runs the RLS integration suite connected as it.
# A green run proves FORCE ROW LEVEL SECURITY is enforcing isolation even against the
# table owner — ENABLE alone would let the owner bypass RLS and leak across tenants.
#
# Usage:  apps/api/scripts/rls-test.sh
# Requires: docker.
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=llame-rls-test
PORT="${RLS_TEST_PORT:-55432}"
IMAGE="${RLS_TEST_PG_IMAGE:-postgres:17-alpine}"
APP_URL="postgres://app:app@localhost:${PORT}/llame_test"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "▶ starting $IMAGE on :$PORT"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres \
  -p "${PORT}:5432" "$IMAGE" >/dev/null

# Host-side reachability probe for the readiness loop below. BOTH: postgres
# accepting INSIDE the container (pg_isready, checked by the caller), AND the
# published port reachable from the HOST. Under WSL2/Docker the host
# port-forward can lag the container's internal readiness by seconds under
# load — checking only `docker exec pg_isready` (internal) let migrate
# connect from the host too early and hit CONNECT_TIMEOUT. `/dev/tcp` confirms
# the host can actually reach the port before we proceed. `127.0.0.1` (not
# `localhost`) matches every other host probe in this script and sidesteps
# hosts where `localhost` resolves IPv6-first to `::1` (docker's `-p` only
# publishes on IPv4). `timeout` is GNU coreutils and isn't guaranteed present
# (e.g. a stock macOS/BSD shell) — fall back to a bare probe there; a
# connection to a closed/absent localhost port fails near-instantly either
# way, so the outer 60-iteration loop below still bounds total wait.
host_reachable() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT}" >/dev/null 2>&1
  else
    bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT}" >/dev/null 2>&1
  fi
}

echo -n "▶ waiting for postgres"
ready=false
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 \
    && host_reachable; then
    ready=true; break
  fi
  echo -n "."; sleep 1
done
if [ "$ready" != true ]; then
  echo " TIMEOUT"
  echo "✗ postgres did not become ready within 60s" >&2
  exit 1
fi
echo " ready"

echo "▶ provisioning non-superuser owner role 'app'"
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" \
  psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE llame_test OWNER app;
SQL
# app must own schema `public` to create tables in it (PG15+ locks this down).
docker exec -e PGPASSWORD=postgres -i "$CONTAINER" \
  psql -h 127.0.0.1 -U postgres -d llame_test -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
ALTER SCHEMA public OWNER TO app;
SQL

echo "▶ applying migrations as 'app' (so app owns every table)"
( cd "$API_DIR" && POSTGRES_URL="$APP_URL" pnpm db:migrate )

echo "▶ running RLS integration suite as 'app'"
( cd "$API_DIR" && TEST_DATABASE_URL="$APP_URL" pnpm exec jest chats-rls.integration --silent=false )

echo "▶ running chat-sharing RLS integration suite as 'app'"
( cd "$API_DIR" && TEST_DATABASE_URL="$APP_URL" pnpm exec jest chat-sharing.integration --silent=false )

echo "▶ running usage aggregation integration suite as 'app'"
( cd "$API_DIR" && TEST_DATABASE_URL="$APP_URL" pnpm exec jest usage.integration --silent=false )

echo "▶ running queue integration suite (pg-boss on the same throwaway Postgres)"
( cd "$API_DIR" && TEST_DATABASE_URL="$APP_URL" pnpm exec jest queue.integration --silent=false )

echo "▶ running auth e2e (real HTTP) against the same database"
( cd "$API_DIR" && POSTGRES_URL="$APP_URL" RUN_STREAM_MAX_MS=20000 pnpm exec jest --config ./test/jest-e2e.json --silent=false )

echo "✓ RLS moat proven + usage aggregation isolation proven + queue substrate proven + auth surface verified end-to-end over HTTP"
