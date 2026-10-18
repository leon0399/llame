#!/usr/bin/env bash
# Experimental API DAST: boots a throwaway llame stack from the e2e fixtures
# (Postgres, mock model, mock MCP, API) and runs Schemathesis and/or the OWASP
# ZAP API scan against apps/api/openapi.json. Reports land in $DAST_OUT_DIR.
#
#   scripts/dast/run-api-scan.sh              # both scanners
#   DAST_SCANNERS=schemathesis scripts/dast/run-api-scan.sh
#
# Scanners run in Docker and reach the host API via host.docker.internal, so
# the same script works on a Linux runner and under Docker Desktop. Exit code
# is non-zero when any scanner reports findings; the workflow is advisory.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dast_dir="$repo_root/scripts/dast"
out_dir="${DAST_OUT_DIR:-$repo_root/dast-report}"
scanners="${DAST_SCANNERS:-schemathesis zap}"

# Distinct from the Playwright defaults (4300-4304, 55433) so both can run.
api_port="${DAST_API_PORT:-4401}"
db_port="${DAST_DB_PORT:-55434}"
db_ready_port="${DAST_DB_READY_PORT:-4402}"
model_port="${DAST_MODEL_PORT:-4403}"
mcp_port="${DAST_MCP_PORT:-4404}"
target_host="${DAST_TARGET_HOST:-host.docker.internal}"
target_url="http://$target_host:$api_port"
local_url="http://localhost:$api_port"

# Pinned by index digest; refresh with `docker buildx imagetools inspect`.
schemathesis_image="${DAST_SCHEMATHESIS_IMAGE:-schemathesis/schemathesis:4.32.0@sha256:c4935c2c27489923b0091246aa831c92166fa169fb8f35ebdeefd408a7a935f5}"
zap_image="${DAST_ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.17.0@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6}"

postgres_url="postgres://app:app@localhost:$db_port/llame_dast"
knowledge_root="$(mktemp -d)"
secrets_dir="$(mktemp -d)"
pids=()

cleanup() {
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$knowledge_root" "$secrets_dir"
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" attempts="${3:-180}"
  for _ in $(seq "$attempts"); do
    if curl -fsS -o /dev/null "$url"; then
      echo "$name ready"
      return 0
    fi
    sleep 1
  done
  echo "$name did not become ready at $url" >&2
  return 1
}

start() {
  local name="$1"
  shift
  "$@" >"$out_dir/logs/$name.log" 2>&1 &
  pids+=("$!")
}

register() {
  local label="$1"
  curl -fsS -X POST "$local_url/auth/v1/register" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"dast-$label-$RANDOM$RANDOM@example.com\",\"name\":\"DAST $label\",\"password\":\"Password123!\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).token;if(!t)process.exit(1);process.stdout.write(t)})'
}

rm -rf "$out_dir"
mkdir -p "$out_dir/logs" "$out_dir/schemathesis" "$out_dir/zap"
# Both images run as their own non-root user.
chmod a+rwx "$out_dir/schemathesis" "$out_dir/zap"
cd "$repo_root"

pnpm exec turbo run build --filter=api --concurrency=1 >"$out_dir/logs/build.log" 2>&1

start db env E2E_DB_PORT="$db_port" E2E_DB_READY_PORT="$db_ready_port" \
  E2E_DB_CONTAINER=llame-dast-postgres POSTGRES_URL="$postgres_url" \
  node --import tsx e2e/support/db-server.ts
start model env E2E_MODEL_PORT="$model_port" node --import tsx e2e/support/model-server.ts
start mcp env E2E_MCP_PORT="$mcp_port" node --import tsx e2e/support/mcp-server.ts
wait_for "http://localhost:$db_ready_port/ready" postgres
wait_for "http://localhost:$model_port/ready" model 30
wait_for "http://localhost:$mcp_port/ready" mcp 30

# Rate limits are lifted for the same reason as in playwright.config.ts: a
# fuzzer from one IP would otherwise measure the throttler, not the API.
start api env NODE_ENV=production PORT="$api_port" POSTGRES_URL="$postgres_url" \
  WEB_ORIGIN=http://localhost:4400 SESSION_COOKIE_DOMAIN=localhost \
  OPENAI_API_KEY=dast-mock-key OPENAI_BASE_URL="http://localhost:$model_port/v1" \
  E2E_MCP_URL="http://localhost:$mcp_port/mcp" E2E_KNOWLEDGE_ROOT="$knowledge_root" \
  AUTH_RATE_LIMIT_PER_MINUTE=100000 API_RATE_LIMIT_PER_MINUTE=1000000 \
  LLAME_CONFIG_PATH="$repo_root/e2e/support/fixtures/llame.config.e2e.json" \
  bash -c 'cd apps/api && exec node dist/main'

wait_for "$local_url/" api 120

# Two peers: Schemathesis replays one's reads as the other (BOLA), ZAP scans as
# the first. Tokens stay in a temp dir outside the uploaded report directory.
alice_token="$(register alice)"
bob_token="$(register bob)"
cat >"$secrets_dir/auth.wfc.json" <<EOF
{"auth": [
  {"name": "alice", "fixedHeaders": [{"name": "Authorization", "value": "Bearer $alice_token"}]},
  {"name": "bob", "fixedHeaders": [{"name": "Authorization", "value": "Bearer $bob_token"}]}
]}
EOF
# The Schemathesis image runs as its own user, which cannot read mktemp's
# 0700 directory on a Linux host. The tokens belong to throwaway accounts.
chmod a+rx "$secrets_dir"
chmod a+r "$secrets_dir/auth.wfc.json"

status=0

if [[ " $scanners " == *" schemathesis "* ]]; then
  docker run --rm --add-host=host.docker.internal:host-gateway \
    -v "$repo_root/apps/api/openapi.json:/spec/openapi.json:ro" \
    -v "$dast_dir/schemathesis.toml:/cfg/schemathesis.toml:ro" \
    -v "$secrets_dir:/secrets:ro" \
    -v "$out_dir/schemathesis:/out" \
    "$schemathesis_image" --config-file /cfg/schemathesis.toml \
    run /spec/openapi.json --url "$target_url" \
    --seed "${DAST_SEED:-20261018}" \
    --report junit,html --report-dir /out \
    2>&1 | tee "$out_dir/schemathesis/console.txt" || status=1
fi

if [[ " $scanners " == *" zap "* ]]; then
  # ZAP adds this header to every request it sends (core auth env vars).
  docker run --rm --add-host=host.docker.internal:host-gateway \
    -e ZAP_AUTH_HEADER=Authorization -e ZAP_AUTH_HEADER_VALUE="Bearer $alice_token" \
    -e DAST_TARGET_URL="$target_url" \
    -v "$repo_root/apps/api/openapi.json:/zap/wrk/openapi.json:ro" \
    -v "$dast_dir/zap-plan.yaml:/zap/wrk/zap-plan.yaml:ro" \
    -v "$out_dir/zap:/zap/wrk/out" \
    "$zap_image" zap.sh -cmd -autorun /zap/wrk/zap-plan.yaml \
    2>&1 | tee "$out_dir/zap/console.txt" || status=1
fi

exit "$status"
