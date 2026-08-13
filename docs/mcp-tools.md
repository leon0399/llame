# MCP tools

llame can connect to operator-managed Model Context Protocol (MCP) servers and
offer selected read operations to the model. This is an instance-scoped,
restart-applied integration: it is not user-configurable, and every API and
worker process owns its own connections.

Two transports are supported. A **remote** server is reached over Streamable
HTTP at a URL you supply. A **local** server is an executable llame runs as a
child process and speaks to over stdin and stdout — the shape most of the MCP
ecosystem ships, including servers with no HTTP mode at all.

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
transport; `"stdio"` selects a local child process (see below). Static header values support llame's existing `{env:NAME}`,
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

## Configure a local stdio server

```jsonc
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server",
        "--read-only",
      ],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_MCP_PAT}" },
    },
  },
  "tools": {
    "allowed": ["mcp__github__search_issues"],
  },
}
```

An entry is exactly `{ type, command, args?, env?, cwd? }`. `command` and each
element of `args` are passed to the operating system verbatim — there is no
shell, so metacharacters are literal text and there is no field that accepts a
whole command line as one string.

**The child's environment is only what you declare.** llame does not pass its
own environment through. The MCP client library copies a small fixed set so a
child can find its executable — on POSIX `HOME`, `LOGNAME`, `PATH`, `SHELL`,
`TERM`, `USER`, and only when llame itself has them — and your `env` merges over
that. Nothing else reaches the child, so llame's datastore URL and provider keys
stay out unless an entry names them.

That is why the `docker run -e NAME` idiom above also declares `NAME` in `env`:
the bare flag tells docker to forward a variable from its own environment, and
without the declaration there is nothing there to forward.

**Interpolating a value marks it as a secret.** The resolved value of every
`{env:…}` / `{path:…}` token in `command`, `args`, or `env` becomes a protected
value: it is redacted from that server's diagnostic output, from tool results,
and from errors. Literal text is never protected. Two consequences follow, and
both bite in practice:

- **Do not interpolate a non-secret.** Protected values are matched as
  substrings across all tool traffic. Interpolating a per-deployment directory
  makes that path protected everywhere, so a tool call naming a file under it is
  refused and a listing that returns it comes back redacted. Write such values
  literally.

  This is easy to do by accident, and the shorter the value the worse it gets.
  Writing `"command": "{env:NODE_BIN:-node}"` resolves to `node`, which then
  becomes a protected substring — and the server's own stack traces come back
  with every `node:internal/...` frame rendered as `[REDACTED]:internal/...`,
  which is a confusing thing to debug. Interpolate credentials, not programs
  or paths.

- **Do not inline a secret.** A credential written directly into the file rather
  than interpolated is not protected, so llame cannot redact it if the server
  echoes it back. Always use `{env:…}` or `{path:…}` for credentials.

`cwd` sets the child's working directory. Without it the child inherits llame's,
which depends on how llame was started — set it if the server resolves relative
paths.

### Running a local server well

- **Pin versions.** `npx -y pkg@latest` re-fetches on every launch in every
  process, so the tool catalog can change between two restarts of an unchanged
  config, and a host without network access fails to start the server at all.
  Prefer a pinned version or a pre-installed binary.
- **Prefer a direct binary or `docker run` over `npx`.** When llame stops a
  server it signals the process it launched. `docker run` forwards that to the
  container and a direct binary is a single process, but `npx` layers extra
  processes in between whose children may survive. Pass `--init` and `--rm` to
  `docker run` so the container reaps its own children and does not accumulate.
- **First launch must finish within 30 seconds**, the same deadline a remote
  connection gets. A cold image pull or a first-time package install can exceed
  it, so pre-pull images and pre-install packages rather than paying that on
  boot.

### What a local server can do to the host

A configured stdio server runs **as the llame user, with llame's filesystem and
network access, and is not sandboxed**. llame bounds the protocol it speaks with
the server, not what the program itself does while running.

That bound is also weaker than the remote one in a specific way worth knowing.
A remote response is capped before it is parsed, so an endpoint cannot force
llame to buffer without limit. The MCP client library reads a child's output
without such a cap, and only splits a message once a newline arrives — so a
local server that writes without ever emitting one can grow that buffer. llame's
own limits on declaration size and retained catalog apply after a message is
parsed, and cannot help before then. This is accepted rather than fixed: it is a
robustness risk from a program the operator chose to install, not an avenue for
a remote party.
Configuring one is the same trust decision as installing software on that host —
make it with the same care, and only for software you would install anyway.

llame also cannot guarantee it stops processes the server itself spawns. It
stops the process it launched, escalating if that process ignores the request.

## Protocol boundary

The supported MCP protocol revisions are the session-capable `2025-03-26`,
`2025-06-18`, and `2025-11-25`, on both transports. llame does not support the
sessionless MCP `2026-07-28` wire shape, deprecated HTTP+SSE, or a fallback
between transports. A server that supports only an excluded revision remains
unavailable; unrelated Runs continue.

## Allow only read operations

Discovered tools are namespaced as `mcp__<server>__<tool>`. A remote tool is
advertised and executable only when its exact namespaced id appears in
`tools.allowed`, or when it matches the only supported wildcard form:
`mcp__<configured-server>__*`. Exact ids are the safer default. An MCP
annotation or description grants no authority.

Both forms are raw, filter-only permissions over the server's safely admitted
exact inventory. They do not create, expand, copy, or deduplicate candidates:
an exact entry and a wildcard can select only an exact id already discovered or
remembered by that process. Wildcards are an operator attestation for every
current and future safely admitted tool in that server's namespace. A remote
server can therefore add a tool that becomes executable without another llame
config change; use a wildcard only when the server's entire current and future
catalog is read-only. Never use it for a mixed-effect server.

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

At startup, an allowlist entry beginning with `mcp__` must be either the exact
canonical output of this algorithm or exactly `mcp__<configured-server>__*`.
The wildcard's server segment must be the case-sensitive canonical id of a
configured `mcpServers` key; bare, partial, mid-string, multiple, malformed,
noncanonical, overlength, and undeclared-server patterns fail startup. This
validation never connects to the server. On a fresh process with no successful
discovery, an offline server contributes no source identities, so neither an
exact entry nor a wildcard fabricates an unavailable id. After a successful
discovery, that process remembers only the last admitted exact ids for outage
disclosure; a complete refresh replaces the set, so omitted or refused ids are
absent (and are disclosed as `Removed` when applicable).

Adding an exact MCP id to `tools.allowed` is the operator's explicit attestation
that that operation is read-only. Adding a namespace wildcard is the same
attestation for every current and future safely admitted operation from that
server. llame cannot verify remote semantic effects. Operators **MUST NOT**
allowlist tools that write, send, delete, execute, perform financial actions, or
administer a system, whether selected exactly or by wildcard. This restriction
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
- A disconnect withdraws that server's callable tools and declarations
  immediately, but retains the last completely admitted exact-id set as
  process-local unavailable source inventory. A **remote** server reconnects
  with AWS Full Jitter between zero and `min(5 minutes, 1 second * 2^n)`,
  continuing until complete discovery succeeds. A **local** server gets a
  bounded burst of those fast attempts and then settles as unavailable, because
  respawning a child process is not free and the usual cause of repeated
  failure is a configuration error no number of retries fixes. A settled server
  is not abandoned: it stays on the periodic occasion below, so a host
  condition that outlives the burst — a dependency that came up late, a
  registry outage — still recovers without a restart, within that interval
  rather than immediately. A fresh process has no remembered ids; a successful complete
  discovery atomically replaces the remembered set, so omitted or refused
  identities become absent/`Removed`. No stale executor or declaration is kept.
- The API and worker can observe different process-local states. A worker
  executes only a declaration whose id and canonical hash match the Run
  snapshot; a missing or changed remote executor becomes a non-fatal
  unavailable tool result rather than a substituted contract.
- Provider requests, availability manifests, receipts, snapshots, persisted
  parts, and execution rebinding contain exact ids and admitted declarations
  only. The wildcard remains restart-applied configuration and is never a
  model-facing or durable identity.
- On a fresh conversation or the first turn after compaction, the model gets an
  availability reminder only when an eligible tool is unavailable. Later turns
  disclose only observable additions, removals, outages, or recoveries.
  Unchanged healthy or unavailable state is not repeated.

## Coordinated rollout and rollback

The API persists availability control data before a worker executes the queued
Run, and dynamic declarations are resolved independently in each process.
Mixed API/worker revisions are therefore unsupported.

First keep `mcpServers` empty and apply the additive model-context snapshot
preparation migration (`20260810154617_perfect_wrecker`) while old API writers
remain active. Then use this order for either worker topology:

1. Quiesce every old API writer and new Chat send.
2. Drain every accepted Run.
3. Apply the writer-cutover migration
   (`20260811084012_thankful_gwen_stacy`). Do not restart an old API writer
   across this cutover.
4. Deploy workers that can read the cutover schema, render
   `data-tool-availability`, and bind dynamic MCP declarations.
5. Deploy the matching v1-authoring API.
6. Only after every process is compatible, add the same `mcpServers`, allowlist,
   and secret inputs to every process and restart the fleet.

For namespace permissions specifically, keep the safer exact-id entries while
deploying wildcard-capable API and workers. Add
`mcp__<configured-server>__*` only after every API and worker is running the
compatible revision and the server's complete catalog has been audited as
read-only. To roll back to an older binary, first restore exact ids, restart
the fleet with that exact allowlist, and only then deploy the older revision;
accepted Runs remain safe because they contain exact ids and declarations.

With dedicated workers, keep API processes on the `web` profile until the
compatible workers are running. With default co-located workers, the API on the
`all` profile is also a Run consumer, so the quiesce and drain gate applies to
the whole fleet before its compatible restart. Alternatively, temporarily move
Run consumption to compatible dedicated workers before any API can accept an
MCP-enabled Run.

Enable one read-only tool first and verify execution, history replay,
outage/recovery disclosure, and secret absence.

Rollback never deploys an old writer across the cutover. For dedicated workers,
first quiesce new sends, restart the accepting API with MCP ids removed from its
allowlist, and drain Runs accepted by the newer API on workers that still
understand the cutover schema. Then remove server entries and restart only
workers and APIs that remain compatible with the cutover schema. For default
co-located workers, quiesce new Chat sends and drain every accepted Run before
any restart, allowlist/server-config removal, or binary rollback; the safe
alternative is to move Run consumption temporarily to compatible dedicated
workers first. Keep the preparation/cutover schema, snapshot columns, and
persisted semantic parts in place; rolling back binaries does not roll back
those migrations.

## Troubleshooting

| Symptom                                                       | Check                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup rejects the config                                    | The entry has only `type`, `url`, and optional `headers`; the type is `http` or `streamable-http`; the URL has no userinfo; the server id follows the grammar above; duplicate server keys and ASCII-case-folded header collisions are absent; transport-owned headers are absent. Config errors intentionally name paths without printing resolved values or credential-bearing URLs. |
| The instance starts but a server stays offline                | Verify endpoint reachability, TLS, authentication, and secret availability from that specific process. A server outage is isolated and reconnect continues in the background. There is no MCP readiness endpoint in this capability.                                                                                                                                                   |
| The receipt reports protocol unsupported                      | The server must negotiate `2025-03-26`, `2025-06-18`, or `2025-11-25`, on either transport. MCP `2026-07-28` and deprecated HTTP+SSE have no fallback.                                                                                                                                                                                                                                 |
| A discovered tool is not advertised                           | Verify its exact `mcp__<server>__<tool>` id is allowlisted or covered by `mcp__<configured-server>__*`. Invalid schemas, unsafe declarations, overlength or colliding normalized names, incomplete pagination, and discovery-budget failures are refused without exposing raw remote declarations.                                                                                     |
| The API advertises a tool but a worker reports it unavailable | API and worker catalogs are process-local. Confirm every worker has the same restarted config and secret inputs and can reach the endpoint; declaration drift also refuses execution for that bound Run.                                                                                                                                                                               |
| A local server never starts                                   | Check the executable resolves on the child's `PATH` (which is llame's, not a login shell's), that first launch completes within 30 seconds, and read the server's own diagnostic output in llame's log — it is captured and attributed to the server id. A missing declared secret is the common cause; `docker run -e NAME` needs `NAME` in the entry's `env` too.                    |
| A local tool refuses calls naming a valid path                | An interpolated low-entropy value became a protected value and is being matched as a substring. Write per-deployment paths literally rather than through `{env:…}`; reserve interpolation for credentials.                                                                                                                                                                             |
| Secret interpolation fails                                    | Ensure the environment variable or mounted file exists and is readable in every process. Do not move the secret into URL userinfo or logs; resolved values are intentionally absent from errors.                                                                                                                                                                                       |
