---
summary: "MCP servers: remote HTTP and stdio configuration, Workspace MCP, and deployment"
read_when:
  - you are configuring mcpServers, an MCP allowlist, or its permission groups
  - you are deploying or troubleshooting MCP discovery and availability
behavior:
  - ../reference/tools/mcp-tools.md
---

# MCP tools

llame connects to operator-managed MCP servers and exposes allowlisted tools
whose calls pass per-tool permissions. Put `mcpServers` in
`apps/api/llame.config.json`; `LLAME_CONFIG_PATH` overrides that path.
Configuration is restart-applied, and every API/worker process owns its clients
and sessions.

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
  "tools": {
    "allowed": ["mcp__web__search"],
    "permissions": { "mcp__web__search": { "allow": true } },
  },
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
  "tools": {
    "allowed": ["mcp__github__search_issues"],
    "permissions": { "mcp__github__search_issues": { "allow": true } },
  },
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

## Workspace MCP

A bound Workspace loads its MCP configuration from `<root>/.mcp.json` and
`<root>/.llame/mcp.json`. Each file accepts either a top-level `mcpServers`
named map or a bare named map. The `.llame/mcp.json` map is applied second:
an entry there replaces the entry with the same server name from `.mcp.json`,
while entries with other names from both files remain available.

Workspace entries use the portable server shape:

```jsonc
{
  "mcpServers": {
    "repo": {
      "command": "node",
      "args": ["tools/mcp-server.mjs"],
      "cwd": "tools",
      "env": { "REPO_TOKEN": "{env:REPO_MCP_TOKEN}" },
    },
    "search": {
      "type": "streamable-http",
      "url": "https://search.example.com/mcp",
      "headers": { "Authorization": "Bearer {env:SEARCH_MCP_TOKEN}" },
    },
  },
}
```

An entry with `command` and no `type` is stdio; `type: "stdio"` is also
accepted. `type: "http"` and `type: "streamable-http"` select the remote
Streamable HTTP transport. Stdio entries may set ordered `args`, declared
`env`, and `cwd`; an omitted `cwd` defaults to the Workspace root and a
relative `cwd` is resolved from that root. The child receives only the MCP
SDK's fixed base environment plus the entry's declared values. Commands and
arguments are passed directly and are never shell-interpreted.

### Interpolation and redaction

Workspace string values support `${VAR}`, `${VAR:-default}`, `{env:VAR}`, and
`{path:LOCATION}`. Resolution uses the executing llame process's environment
and filesystem, including llame's own environment. A relative `{path:...}`
location is resolved from the Workspace root; an absolute location is used as
written. `${VAR:-default}` uses its literal default when the variable is unset
or empty. Resolution is single-pass: a resolved value is not scanned again
for interpolation.

`{{` is not an escape in Workspace files: `--template={{name}}` remains
verbatim.

An unset variable without a default or an unreadable file makes only that
server unavailable. Its safe diagnostic names the variable or file location,
never the resolved value. A malformed file is unavailable as a file rather
than partially admitted; an invalid server name or entry, or an unsupported
transport, makes that server unavailable. Workspace entry still succeeds and
reports each server's state; unavailable servers contribute no callable tools.

Protected values are tracked per Workspace server. Every non-empty remote URL
interpolation substitution and remote header interpolation substitution is
protected. Every non-empty final remote header value is protected, whether
literal or interpolated. Resolved interpolation substitutions in stdio
`command`, `args`, `env`, and `cwd` are protected. A literal supplied only as
a `${VAR:-default}` fallback is excluded in stdio `command`, `args`, and `env`;
the fallback in `cwd` remains protected. A literal stdio `env` value is not
protected merely because it is literal. llame redacts protected values from
that server's declarations, call arguments and results, diagnostics, entry
result, receipts, persisted errors, and model-facing content. This is a
per-server guarantee: another tool that independently reads the same source
is outside it. A value placed in a stdio command or argument still exists in
the child argv and may be visible through `/proc/<pid>/cmdline`; put
credentials in `env` instead.

Entering a Workspace is the trust decision for reading and starting its MCP
configuration, including later client starts; there is no separate per-server
permission check. This is an audited-repository boundary: repository config
may read the executing llame process's host environment and files, and stdio
servers run unsandboxed as the llame OS user. Allowing entry to a directory
where any allowlisted tool can write — `bash`, native `write`/`edit` without
the W1/W2 rejects in [Native file tools](native-files.md#workspace-entry), or
write-capable operator or Workspace MCP tools — is equivalent to
`execute_code` and host-secret exfiltration. Workspace MCP calls still require
their normal `tools.allowed` eligibility and `tools.permissions` authorization.

### Lifetime and isolation

Workspace clients are separate from the process-wide operator MCP runtime.
Each client set is owned by one Chat and keyed by
`(chatId, canonicalRoot, workspaceGeneration)`. A successful entry starts the
matching clients in the executing process and awaits initial connect/discovery
within the existing MCP startup/discovery bounds. A bound Chat whose clients
are not running in the process starts them at attempt start and awaits initial
connect/discovery before tool composition.
`workspaceGeneration` increments when entry establishes a binding, a switch
replaces it, an exit clears it, or preparation detaches it. Same-root re-entry
and exit on an unbound Chat leave the generation unchanged.
Each new client start rereads both Workspace MCP files and reapplies
interpolation.

At every attempt start, stale client keys for that Chat are stopped and
discarded before the current key is started. Exit, switch, detach, and process
shutdown stop the current clients; another process discards stale keys at its
next attempt. Idle clients are stopped after 30 minutes without a Run, and a
later Run starts a fresh generation-matching set. Same-root re-entry is a
no-op: it keeps the clients and does not reread configuration. The
Workspace resolver for the current key is layered over the operator resolver,
so declarations, executors, call state, and results never cross Chats or
owners, even when server names match.

### Shadowing and Run availability

Workspace and operator servers shadow only when their server ids are byte-equal.
If a Workspace server starts after the operator server's tools are already
declared in the active Run, it contributes no tools in that Run and the entry
result says `shadows from the next Run`; operator executors remain in place for
the rest of that Run. From the next Run, the successfully started Workspace
server supplies the same namespaced tool ids under the same exact-id
permission groups. A server that fails or is unavailable does not shadow.

A Workspace server whose id differs from an operator id only by ASCII case is
unavailable with reason `case-only collision with an operator server`, adds no
tools, and leaves the operator server unchanged. A successfully admitted
non-shadowing Workspace tool can be added to the entering Run and called on
the next model step. A later Run composes currently admitted Workspace tools
from its start, so the normal tool-availability announcement reports them.

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
`mcp__<server>__*`; malformed or noncanonical patterns fail boot without
connecting. A grammar-valid MCP ID or wildcard may name a server that is not
configured yet. Fresh offline processes invent no unavailable IDs. After
successful discovery, each process retains only its last fully admitted exact
IDs for outage disclosure.

## Authorization and recovery

An exact allowlist entry or namespace wildcard selects safely admitted MCP
identities for a Run; it does not attest to an operation's effects. Every MCP
call also requires an applicable `tools.permissions` group. Remote annotations
grant no authority, and a missing or rejecting permission group refuses the
call. Write, send, delete, execute, financial, and administrative operations
are allowed only when the source is allowlisted and the call passes its
permission group.

The worker records each MCP dispatch before invoking it. On queue redelivery,
any Run with a recorded native attempt or MCP dispatch fails as
`outcome_unknown` without re-running its model loop; open calls settle from
durable results where present, and no recorded operation is invoked again. A
Run with no native or MCP attempt may restart its tool loop from the first
step. MCP calls have no automatic retry.

## Workspace entry migration

**Breaking:** an MCP allowlist no longer attests that a tool is read-only. What
it selects, and the permission group every call needs, are described in
[MCP tools](../reference/tools/mcp-tools.md); the Workspace entry policy and
its W1/W2 rejects are in [Native file tools](native-files.md#workspace-entry).

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
  canonical-hash match against the attempt's admitted declaration; mismatch
  settles unavailable.
- Provider input, manifests, and rebinding
  contain exact admitted IDs/declarations, never wildcard config.
- Availability reminders appear on a fresh conversation/after compaction and
  later only for changes.

## Deployment

Pre-alpha deployments run one code revision. Restart every API and worker with
matching server config, allowlists, secrets, and reachability. Enable one
exact MCP tool first and verify execution, permission denial, outage recovery,
unknown-outcome recovery, and secret absence before adding more.

Before an availability-writer migration, stop API writers and drain accepted
Runs on compatible workers. Apply the migration, then restart every process on
the matching revision. Rollback stops new authoring, drains accepted Runs on
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
