# Remote MCP tools

llame can connect to operator-managed Model Context Protocol (MCP) servers and
offer selected remote read operations to the model. This is an instance-scoped,
restart-applied integration: it is not user-configurable, and every API and
worker process owns its own connections.

## Configure a server

Add the portable `.mcp.json`-compatible `mcpServers` map to
`apps/api/llame.config.json`. Each entry is exactly `{ type, url, headers? }`:

```jsonc
{
  "mcpServers": {
    "web": {
      "type": "streamable-http",
      "url": "https://search.example.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:SEARCH_MCP_TOKEN}",
      },
    },
  },
  "tools": {
    "allowed": ["search_conversations", "mcp__web__search"],
  },
}
```

`"http"` and `"streamable-http"` are aliases for the same Streamable HTTP
transport. Static header values support llame's existing `{env:NAME}`,
`{env:NAME:-default}`, and `{path:LOCATION}` interpolation. An interpolated
`Authorization` header is the normal authentication path. Resolved header
values and MCP session ids remain transport-only: they are never included in
model input, user-visible receipts, run events, persisted errors, or logs.

The URL must be absolute `http` or `https`. Userinfo such as
`https://user:password@example.com/mcp` is rejected; put authentication in an
interpolated header instead. Unknown entry fields and attempts to override
transport-owned headers fail startup.

Server and allowlist changes take effect only after restart. Apply the same
configuration and secret inputs to every API, co-located consumer, and
dedicated worker process. The allowlist decision is bound when a Run is
accepted, so a later config removal affects new Runs but does not rebind an
already accepted Run or its queue retry.

## Protocol boundary

The supported MCP protocol revisions are the session-capable Streamable HTTP
revisions `2025-03-26`, `2025-06-18`, and `2025-11-25`. llame does not support
the sessionless MCP `2026-07-28` wire shape, deprecated HTTP+SSE, stdio, or a
fallback between transports. A server that supports only an excluded revision
remains unavailable; unrelated Runs continue.

## Allow only read operations

Discovered tools are namespaced as `mcp__<server>__<tool>`. A remote tool is
advertised and executable only when its exact namespaced id appears in
`tools.allowed`. An MCP annotation or description grants no authority.

Derive that allowlist id with the provider-independent `mcp-tool-id-v1`
algorithm:

1. Use the configured `mcpServers` key as the server segment exactly as written.
   It is not normalized or case-folded. It must be non-empty ASCII
   `[A-Za-z0-9_-]+`, must not contain the reserved `__` separator, and can be at
   most 56 characters so the 64-character final id can still contain a
   one-character tool segment.
2. Unicode-NFKC-normalize the discovered MCP tool name. Replace each maximal
   run outside ASCII `[A-Za-z0-9_-]` with one `_`, remove leading and trailing
   `_`, and preserve ASCII letter case.
3. Compose `mcp__<server>__<normalized-tool>`. The complete ASCII id must be at
   most 64 characters; equivalently, the normalized tool segment can contain at
   most `57 - <server length>` characters.

For example, server `web` and discovered name `Find／Docs` produce
`mcp__web__Find_Docs`. llame never truncates or adds a hash, ordinal, or other
suffix. An empty normalized tool segment, an overlength id, or an id rejected by
an executable provider is refused. ASCII-case-folded collisions are checked
across the complete composed catalog, including code-owned tools and other MCP
servers; every member of a colliding set is refused while non-colliding siblings
remain eligible.

At startup, an allowlist entry beginning with `mcp__` must already be the exact
canonical output of this algorithm and its case-sensitive server segment must
name a configured `mcpServers` key. A malformed, noncanonical, overlength, or
undeclared-server entry fails startup. The server may be offline and the tool
need not have been discovered yet; in that case startup succeeds but the id
remains unavailable until that exact declaration is discovered and admitted.

Adding an MCP id to `tools.allowed` is the operator's explicit attestation that
the operation is read-only. llame cannot verify the remote operation's semantic
effects. Operators **MUST NOT** allowlist tools that write, send, delete,
execute, perform financial actions, or administer a system. This restriction
also applies to operations claiming to be idempotent.

The run queue provides at-least-once recovery. If a worker dies after a remote
read executed but before its result settles durably, a queue retry may execute
that read again. MCP calls themselves are not automatically retried.

## Trust and outbound data

Configuring a server creates an operator-approved outbound trust boundary.
Tool arguments derived from conversation content leave llame and are visible to
that server. A malicious or compromised endpoint can exfiltrate any data the
model places in those arguments. Treat the endpoint and its operator as trusted
for the data users may send through allowlisted tools.

Redirects are disabled so an approved URL cannot silently move a request to a
different destination. Private and loopback endpoints are intentionally
allowed because local, operator-owned services are a primary self-hosted use
case; llame does not apply an IP or DNS denylist. This is not a network sandbox.

## Runtime behavior

- Every process eagerly creates an independent client and session for each
  configured server. One server's failure does not block startup, other
  servers, native tools, or answer-only Runs.
- Each ready client completely refreshes its catalog in the background every
  independently jittered 48–72 minutes. Turns use the last atomically published
  catalog immediately and never wait for discovery or reconnect network I/O.
- A disconnect withdraws that server's tools. Reconnect uses a fresh client and
  session with AWS Full Jitter between zero and
  `min(5 minutes, 1 second * 2^n)`, continuing until complete discovery
  succeeds.
- The API and worker can observe different process-local states. A worker
  executes only a declaration whose id and canonical hash match the Run
  snapshot; a missing or changed remote executor becomes a non-fatal
  unavailable tool result rather than a substituted contract.
- On a fresh conversation or the first turn after compaction, the model gets an
  availability reminder only when an eligible tool is unavailable. Later turns
  disclose only observable additions, removals, outages, or recoveries.
  Unchanged healthy or unavailable state is not repeated.

## Coordinated rollout and rollback

The API persists availability control data before a worker executes the queued
Run, and dynamic declarations are resolved independently in each process.
Mixed API/worker revisions are therefore unsupported.

First keep `mcpServers` empty and apply the additive model-context snapshot
migration. The remaining order depends on the worker topology:

- **Dedicated workers:** with API processes on the `web` profile, drain and
  replace old Run consumers first. Deploy workers that can render
  `data-tool-availability` and bind dynamic MCP declarations, then deploy the
  matching API. Only after every binary is compatible, add the same
  `mcpServers`, allowlist, and secret inputs to every process and restart the
  fleet.
- **Default co-located workers:** an API process on the default `all` profile is
  also a Run consumer, so there is no separate worker-first deployment. Quiesce
  new Chat sends, drain every accepted Run, and restart all co-located processes
  on the compatible binary while `mcpServers` remains empty. Before the later
  restart that enables MCP configuration, quiesce sends and drain again so a
  Run cannot be accepted by one process and claimed by another with old or empty
  config. Alternatively, temporarily deploy compatible dedicated workers and
  move every API process to the `web` profile before any API can accept an
  MCP-enabled Run; then use the dedicated-worker sequence.

Enable one read-only tool first and verify execution, history replay,
outage/recovery disclosure, and secret absence.

For rollback with dedicated workers, first quiesce sends, restart the API with
MCP ids removed from its allowlist, then resume non-MCP sends while the still-
capable workers and their MCP configuration drain already bound Runs. Remove the
server entries and roll workers/API back only after that drain. With default
co-located workers, quiesce new Chat sends and drain every accepted Run before
any restart, allowlist/server-config removal, or binary rollback; the safe
alternative is to move Run consumption temporarily to compatible dedicated
workers first. Retain the additive snapshot columns and persisted semantic
parts; deleting them is unnecessary and destructive.

## Troubleshooting

| Symptom                                                       | Check                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup rejects the config                                    | The entry has only `type`, `url`, and optional `headers`; the type is `http` or `streamable-http`; the URL has no userinfo; the server id follows the grammar above; duplicate server keys and ASCII-case-folded header collisions are absent; transport-owned headers are absent. Config errors intentionally name paths without printing resolved values or credential-bearing URLs. |
| The instance starts but a server stays offline                | Verify endpoint reachability, TLS, authentication, and secret availability from that specific process. A server outage is isolated and reconnect continues in the background. There is no MCP readiness endpoint in this capability.                                                                                                                                                   |
| The receipt reports protocol unsupported                      | The server must negotiate `2025-03-26`, `2025-06-18`, or `2025-11-25`. MCP `2026-07-28`, deprecated HTTP+SSE, and stdio have no fallback.                                                                                                                                                                                                                                              |
| A discovered tool is not advertised                           | Verify the exact `mcp__<server>__<tool>` id is allowlisted. Invalid schemas, unsafe declarations, overlength or colliding normalized names, incomplete pagination, and discovery-budget failures are refused without exposing raw remote declarations.                                                                                                                                 |
| The API advertises a tool but a worker reports it unavailable | API and worker catalogs are process-local. Confirm every worker has the same restarted config and secret inputs and can reach the endpoint; declaration drift also refuses execution for that bound Run.                                                                                                                                                                               |
| Secret interpolation fails                                    | Ensure the environment variable or mounted file exists and is readable in every process. Do not move the secret into URL userinfo or logs; resolved values are intentionally absent from errors.                                                                                                                                                                                       |
