# MCP tools

llame connects to operator-managed MCP servers and exposes selected read-only
tools. Put `mcpServers` in `apps/api/llame.config.json`; `LLAME_CONFIG_PATH`
overrides that path. Configuration is restart-applied, and every API/worker
process owns its clients and sessions.

## Configure remote HTTP

```jsonc
{
  "mcpServers": {
    "web": {
      "type": "streamable-http",
      "url": "https://search.example.com/mcp",
      "headers": { "Authorization": "Bearer {env:SEARCH_MCP_TOKEN}" },
    },
  },
  "tools": { "allowed": ["mcp__web__search"] },
}
```

Remote entries are `{ type, url, headers? }`; `http` and `streamable-http` are
aliases. URLs must be absolute HTTP(S) without userinfo. Unknown fields and
transport-owned header overrides fail startup. Use interpolated headers for
credentials. Config, allowlists, and secrets must match every process after
restart; accepted Runs retain their bound declarations. Resolved headers and
session IDs remain transport-only and never enter model input, receipts,
persistence, errors, or logs.

## Configure local stdio

```jsonc
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "--init", "-e", "GITHUB_TOKEN", "image"],
      "env": { "GITHUB_TOKEN": "{env:GITHUB_MCP_PAT}" },
    },
  },
  "tools": { "allowed": ["mcp__github__search_issues"] },
}
```

Stdio entries are `{ type, command, args?, env?, cwd? }`. No shell parses the
command or args. The child receives only the MCP SDK's small POSIX base env plus
declared `env`; llame's provider/database secrets do not pass through.

Interpolation marks only substituted values as protected. Therefore:

- Interpolate credentials, not low-entropy programs or paths; substring
  redaction may otherwise refuse valid calls and corrupt diagnostics.
- Never inline credentials; literals are not protected.
- Put credentials in `env`, not args visible in `/proc/<pid>/cmdline`.

Set `cwd` when the server uses relative paths. Pin binaries/images, prefer a
direct binary or `docker run --init --rm` over `npx`, and ensure first launch
finishes within 30 seconds.

Stdio runs unsandboxed as the llame user with its filesystem/network access.
Stderr is captured, bounded, sanitized, and attributed to the server. Every
remote response/SSE event and stdio message is capped at 1 MiB before parsing;
excess stops the local server. llame signals only the process it launched and
cannot guarantee cleanup of grandchildren. Treat configuration as installing
host software.

## Protocol and IDs

Supported session protocols: `2025-03-26`, `2025-06-18`, `2025-11-25` on both
transports. Sessionless `2026-07-28`, deprecated HTTP+SSE, and transport
fallbacks are unsupported.

Tools use `mcp__<server>__<tool>`:

1. Server key is case-sensitive ASCII `[A-Za-z0-9_-]+`, excludes `__`, and is
   at most 56 characters.
2. NFKC-normalize the remote name; collapse each run outside
   `[A-Za-z0-9_-]` to `_`; trim edge underscores; preserve ASCII case.
3. Prefix with `mcp__<server>__`; final ID is at most 64 characters.

IDs are never truncated or suffixed. Empty/long/non-executable names are
refused. ASCII-case-folded collisions across native and MCP catalogs refuse
every colliding member.

Allowlist entries must be an exact canonical ID or exactly
`mcp__<configured-server>__*`; malformed/noncanonical/unknown-server patterns
fail boot without connecting. Fresh offline processes invent no unavailable
IDs. After successful discovery, each process retains only its last fully
admitted exact IDs for outage disclosure.

## Read-only authority

Exact allowlisting attests one tool is read-only. A wildcard attests every
current and future safely admitted tool from that server is read-only. Remote
annotations grant no authority. Never allowlist write, send, delete, execute,
financial, or administrative tools, including nominally idempotent ones.

Run recovery is at least once: a worker death after execution but before durable
settlement may repeat a read. MCP calls have no automatic retry.

Tool arguments leave llame. Trust the server for any conversation data the
model may send. Redirects are disabled. Private/loopback endpoints are allowed;
MCP is not a network sandbox.

## Runtime

- Each process eagerly creates one client/session per server. One failure does
  not block startup, native tools, or other servers.
- Complete discovery refreshes every jittered 48-72 minutes. Turns use the last
  atomically published catalog and never wait for network I/O.
- Disconnect withdraws executors immediately while retaining admitted IDs for
  unavailable disclosure. Remote reconnect uses full jitter capped at five
  minutes. Stdio retries in a bounded burst, then only on periodic refresh.
- Complete discovery replaces remembered IDs; no stale declaration/executor is
  retained.
- API and worker state may differ. Workers execute only an exact ID plus
  canonical-hash match from the Run snapshot; mismatch settles unavailable.
- Provider input, manifests, receipts, snapshots, persistence, and rebinding
  contain exact admitted IDs/declarations, never wildcard config.
- Availability reminders appear on a fresh conversation/after compaction and
  later only for changes.

## Deployment

Pre-alpha deployments run one code revision. Restart every API and worker with
matching server config, allowlists, secrets, and reachability. Enable one exact
read-only tool first and verify execution, replay, outage recovery, and secret
absence before adding more.

Before an availability-writer migration, stop API writers and drain accepted
Runs on compatible workers. Apply the migration, then restart every process on
the matching revision. Rollback stops new authoring, drains bound Runs on
compatible workers, then reverses the schema and binary order.

## Troubleshooting

| Symptom                            | Check                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Config rejected                    | exact entry fields/type; URL/userinfo; server-ID grammar; header collisions/ownership |
| Server offline                     | reachability, TLS, auth, and secret availability from that process                    |
| Protocol unsupported               | server negotiates one of the three supported revisions                                |
| Tool missing                       | canonical allowlist ID/wildcard; schema/name collisions; complete bounded discovery   |
| API advertises, worker unavailable | matching restarted config/secrets, endpoint reachability, declaration hash            |
| Stdio server fails                 | executable on inherited `PATH`, declared env, sub-30-second startup, captured stderr  |
| Valid path refused/redacted        | a low-entropy interpolated value became protected                                     |
| Secret interpolation fails         | env/file exists in every process; never move it into URL/log output                   |
