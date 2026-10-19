# Design

## Context

See proposal.md for motivation. Current state that shapes the approach:

- Native tools execute in the worker process. `executeNative` and
  `executeLocator` in `apps/api/src/tools/native-files.ts` are the only scheme
  table (`kb://`, `skill://`, `media://`, web); `executeNativeBound` records the
  durable native attempt and requires `tools.nativeExecutorId`. `kb://`
  mutations use an unbound fence (`NativeFenceMode {bound:false}`), the model
  for Machine mutations. `serializeMutation` runs every mutation in a worker one
  at a time.
- `packages/native-file-tools` (host-path entry points plus `statHostPath`) and
  `packages/bash-executor` have no NestJS or database dependency.
  `bash-executor` counts active processes per process; `apps/api/src/tools/bash.ts`
  passes the bounds (32,000 output, 8,000 input, 300,000 ms, `maxProcesses: 1`)
  and builds the managed base environment.
- The tool candidate resolver offers `bash` only with `tools.nativeExecutorId`
  and `edit`/`write` with it or a Knowledge root; `enter_workspace`,
  `exit_workspace`, `bash`, and instruction loading also gate on it.
- The Workspace binding is `chats.workspace_root`, `workspace_executor_id`,
  `workspace_generation`, `workspace_told`, with six DB-checked detach reasons.
  Preparation compares the bound executor with `tools.nativeExecutorId` and
  checks `stat` plus `realpath` of the root. `resolveWorkspacePath` is
  `posix.resolve` and is called from native files, permission projection, the
  runner's argument projection, `bash`, prompt imports, and the instructions
  producer.
- Instruction discovery uses `hostInstructionScope()` (root `/`, local
  `statHostPath` and `readdir`); only page bodies go through `read`. The skill
  catalog's `SkillCatalogFileSystem` and `getSnapshot` are synchronous.
- Workspace MCP clients are keyed by `{chatId, root, generation}`.
  `McpServerClient` (private constructor, static factories) builds clients with
  `@ai-sdk/mcp` `createMCPClient`, whose seam is `MCPTransport`;
  `connectStdio` calls `createStdioTransport`. HTTP safeguards (session-id
  change detection, `redirect: 'error'`, discovery byte totals) live in
  `mcp-server-client.ts`.
- `MEDIA_MAX_BYTES` is 20 MiB; the stdio message cap is 1 MiB.
- pg-boss 12 cron fires at minute granularity.
- Live updates are owner-routed only.

Decision provenance is the grilling record behind the
[multi-device placement study](../../../docs/research/product-vision/2026-10-18-multi-device-execution-placement.md).

## Goals / Non-Goals

**Goals:**

- One remote path reusing the local tool implementations.
- No new listener, broker, or mailbox: workers dial Machines directly.
- Hub credentials never leave the hub; Machine-resolved secrets reach the hub
  only as redaction inputs.

**Non-Goals:**

- A second authentication system: SSH authenticates both ends.
- Durable delivery of tool calls, call re-attach, or a Machine-side ledger.
- Isolation between hub users on a shared Machine.
- Generalizing locator dispatch into an adapter framework (#1011).

## Decisions

### D1. SSH through a generated safety block plus the operator's SSH config

Jump hosts ignore command-line `-o`/`-i` options (ssh(1): command-line
directives apply to the destination, not jump hosts), so the hub writes a
private configuration file and runs
`ssh -F <absolute generated path> -T -- <destination> llame-machine serve --stdio`,
passing a `[user@]host:port` destination as `ssh://[user@]host:port`, since
OpenSSH reads a bare `host:port` as a host name.
The file starts with a `Host *` safety block and then
`Include <machines.ssh.configFile or ~/.ssh/config>`. ssh keeps the first
value it obtains, so the block wins for the destination and every `ProxyJump`
hop while the included file supplies aliases, `HostName`, `User`, `Port`,
`ProxyJump` chains, and identities. A `ProxyCommand` is an arbitrary command
that does not read the generated file, so a hop it opens is outside the
block's guarantees; the operator page tells operators to keep it out of the
hosts llame uses. Safety block: `UserKnownHostsFile <pinned>`,
`GlobalKnownHostsFile none`, `StrictHostKeyChecking yes`, `BatchMode yes`,
`IdentityAgent none`, `ForwardAgent no`, `ForwardX11 no`, `ControlMaster no`,
`ControlPath none`, `PermitLocalCommand no`, `UpdateHostKeys no`,
`ConnectTimeout 10`, `ServerAliveInterval 15`, `ServerAliveCountMax 3`, and
the optional llame `IdentityFile`. Verified with OpenSSH 8.9: `ssh -G` resolves
the included alias, `ProxyJump`, and identities while the block's host-key,
batch, agent, and connection-sharing values win, and `-v` shows the implicit
jump command carries `-F`. Identities accumulate, so the included
configuration's keys are also offered. `SendEnv` accumulates and cannot be
cleared from the block; the operator page warns about it.

A pinned-only mode that omits the `Include` and generates route blocks from
llame configuration is a later, additive option.

Box setup: `restrict,command="/usr/local/bin/llame-machine serve --stdio"`
for the hub key (absolute path), optional `from=`, and sshd
`ClientAliveInterval` documented.

Alternatives: dial-out WebSocket (enrollment, relays, cross-process routing);
inbound connections to workers (ingress). Both stay possible as additional
transports.

### D2. Protocol: framed JSON with stream ids, credits, and chunks

Frame: `{ "s": <stream>, "m": <JSON-RPC 2.0 message> }`, newline-delimited.
The 1 MiB cap applies to `m`; the wrapper is outside it. Stream ids are
monotonic per session and never reused; frames for unknown or closed streams
are dropped. Stream 0 carries the handshake (`hello` with protocol and daemon
versions), a 15-second heartbeat (three misses end the session), and control.
Per-stream credit windows and a per-session cap on open streams and buffered
bytes keep one stream from starving the others.

| Method                                                                         | Purpose                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `roots.list`                                                                   | registered roots                                                           |
| `fs.stat`                                                                      | kind, size, canonical locator, link flag, checked against roots            |
| `fs.list`                                                                      | structured directory entries for discovery                                 |
| `fs.read`, `fs.edit`, `fs.write`                                               | `native-file-tools` entry points; results with Machine locators            |
| `fs.bytes`                                                                     | chunked file bytes up to `MEDIA_MAX_BYTES`, for media                      |
| `proc.bash`, `proc.cancel`                                                     | `executeManagedBash`; cancel targets the stream                            |
| `mcp.servers`                                                                  | Workspace MCP definitions resolved on the Machine                          |
| `mcp.open`, `mcp.message`, `mcp.stderr`, `mcp.close`, `mcp.setProtocolVersion` | relay one server; `open` returns the started definition's protected values |

Every request carries `{runId, attemptId, toolCallId, deliverySeq, budgetMs}`;
the daemon measures `budgetMs` from receipt on its monotonic clock, refuses an
exhausted budget, and terminates in-flight work when it runs out. Shared
constants (bash bounds, frame caps, media cap) live in the protocol package.

### D3. Session manager in each worker

One SSH session per worker per Machine, opened on first use, kept while any
stream is open, closed after five idle minutes. Reachability is decided once
per attempt: a failed open marks the Machine unreachable for the rest of that
attempt, so preparation, instructions, skills, and MCP do not each wait out a
timeout. Session events write Machine status. When the session ends, every open
stream fails: calls settle under D4, MCP channels close. The daemon terminates
every process group it started when stdin closes or heartbeats stop.

Mutations to a Machine serialize per Machine, not through the worker-wide
`serializeMutation`, so a slow Machine never blocks local or `kb://` writes.

### D4. Locator, fence, and gates

`executeLocator` gains a `machine` branch. Reads use no fence; `edit`, `write`,
and Machine `bash` use the native attempt with an unbound fence. A failure to
open the session before dispatch returns `machine_unavailable`; a session lost
after the attempt row and before a result settles through the existing prior-
outcome path as `outcome_unknown`. Machine media: the daemon returns metadata
and streams bytes through `fs.bytes`; the hub prepares and stores media through
a byte-buffer entry point added to `native-file-tools`, since `readFile`'s
media hook assumes a local file.

The candidate resolver offers `read`, `edit`, `write`, `bash`,
`enter_workspace`, and `exit_workspace` when Machines are configured even
without `tools.nativeExecutorId`; local host paths still return
`executor_unavailable` there. Machine operations never call `native.bind`.

### D5. Paths, Workspace binding, and offline state

A Machine Workspace stores `workspace_root = machine://<name><canonical path>`
and `workspace_executor_id = machine:<name>`; a binding is classified by the
root's scheme and both columns must agree. `tools.nativeExecutorId` may not
start with `machine:`. `resolveWorkspacePath` gains a Machine branch and throws
on any non-absolute, non-Machine root, so an unmigrated call site fails closed;
all six call sites are migrated. While bound to a Machine, bare absolute paths
and absolute `bash` `cwd` are rewritten to that Machine's locator before
permission projection and execution; `file:` aliases keep addressing the local
executor.

Preparation for `machine:` executors checks the name is configured (else
detach `executor_absent`, narrated as a removed Machine) and, when reachable,
runs `fs.stat` for `root_missing` and `root_moved`. When unreachable it keeps
the binding. New column `chats.workspace_told_available` (nullable boolean)
records the availability last narrated, so unavailability and recovery are each
told once; the context-injection producer compares it with the attempt's
reachability.

### D6. Workspace MCP through a relayed transport

A new `McpServerClient` static factory accepts an `MCPTransport`.
`MachineTransport` implements it over an `mcp.*` stream, including
`protocolVersion` and `setProtocolVersion`, and the hub applies the stdio-style
protocol-version check after the handshake. Hub-side discovery for a Machine
Workspace calls `mcp.servers` instead of reading `.mcp.json`, builds runtime
definitions from the returned names, kinds, states, and diagnostics, and feeds
the unchanged admission, shadowing, and redaction path. `mcp.open` returns the
protected values of the definition actually started and later-learned ones
(HTTP session id), and the hub treats them as secrets on arrival. On the
Machine the daemon uses the shared config resolver, the shared guarded fetch
with `redirect: 'error'` and session tracking, and the MCP SDK stdio or
Streamable HTTP transport. stderr flows as bounded `mcp.stderr` diagnostics.
The client key adds the executor id. SSE resumption is not relayed.

Alternative: the MCP client on the Machine (two MCP stacks; the hub would
trust Machine-reported declarations).

### D7. Instruction files and skills through Machine scopes

A Machine `InstructionScope` uses the registered root containing the target as
its root, `fs.stat` as `probe`, `fs.list` as `list`, and Machine locators as
keys and labels; the instructions producer recognizes Machine targets as
triggers, and prompt imports resolve Machine-relative targets. Skills:
preparation fetches a bounded snapshot of the Machine Workspace's skill sources
asynchronously and hands the synchronous catalog an in-memory
`SkillCatalogFileSystem`; Machine skill file reads route through `fs.read`.
The catalog interface stays synchronous.

### D8. Permission projection

`projectNativeFilePath` and `withoutReadSelector` gain a Machine branch: split
the selector, decode the path once, emit
`machine://<lowercase name><decoded path>` with `.`, `..`, and trailing
separators kept. Following the `file:` alias rule, a reject on either the
submitted or canonical text refuses; the allow is decided on the canonical
text. Machine skill reads are projected as Machine locators.

### D9. Status table, probe, and API

Table `machines_status` (name primary key, first and last contact, last
failure time, closed reason, hub and daemon protocol versions, daemon version,
bounded roots list, updated time) with ENABLE and FORCE RLS and a SELECT policy
requiring a non-empty current identity, written through a system path.
Daemon-supplied strings are bounded. A pg-boss job scheduled every minute
probes every configured Machine, declared in `asyncapi.queues.yaml`; session
events also write status. Status is online when last contact is within 150
seconds and after the last failure. The reason comes from the handshake or
from recognized `ssh` exit status and stderr. `GET /api/v1/machines` serves
the list to authenticated users. A trigger on `machines_status` notifies the
live hub of every insert and update, and the hub pushes `machine.upserted`
(the same row as the endpoint) to every connection, since the record is
instance-wide.

### D10. Web

A read-only Machines section in settings and a Machine state in the chat's
session details sidebar. Both read `GET /api/v1/machines` once and apply
`machine.upserted` messages to that cached list; a socket reconnect or
`resync` refetches it. Neither polls.

### D11. Daemon and packaging

`apps/machine`, TypeScript on Node >= 22.19, bundled to a single file with a
`bin` entry `llame-machine`, installed by copying it onto the box (for example
`/usr/local/bin/llame-machine`). Roots live in the daemon user's
`$XDG_CONFIG_HOME/llame-machine/roots.json`, edited with
`llame-machine roots add|remove|list`. Roots bound addressing only: anything
running as the Machine user, including Machine `bash` and Workspace MCP
servers, can edit the roots file, and the daemon loads it once per session.

### D12. Configuration

```jsonc
{
  "machines": {
    "ssh": {
      "identityFile": "/etc/llame/machine_ed25519",
      "knownHostsFile": "/etc/llame/machine_known_hosts",
    },
    "hosts": {
      "devl": { "destination": "box" },
      "gpu": { "destination": "me@gpu.lan:2222" },
    },
  },
}
```

The whole `machines.ssh` block is optional: `knownHostsFile` defaults to the
worker user's `~/.ssh/known_hosts`, `configFile` to `~/.ssh/config`, and
`identityFile` is absent unless set. Relative files
resolve from the config file. Destinations reject interpolation and
option-shaped values. The published schema and `BUILT_IN_DEFAULTS` gain the
section. The worker image or host needs an `ssh` client, the pinned file, and
whatever the included SSH configuration references.

## Threats

- **T1. Model-addressed remote execution.** VISION says the model never
  chooses native execution. Here the operator chooses Machines and which
  `machine://` text each permission group admits, and the daemon enforces
  roots; the model picks among admitted addresses, as with absolute local
  paths. Disclosed in tool descriptions.
- **T2. Shared Machine runs repository commands.** Operator-wide Machines and
  entry-is-trust mean any user allowed to enter a Machine Workspace starts that
  repository's MCP servers as the Machine user.
- **T3. Hub key compromise.** Forced command and `restrict` limit a dedicated
  llame key to starting the daemon; identities supplied by the included SSH
  configuration carry whatever authority the operator gave them.
- **T4. Secret flows.** Hub to Machine: interpolation runs on the Machine and
  the hub never sends commands, URLs, or headers. Machine to hub: protected
  values arrive as secrets and are redacted.
- **T5. No isolation between owners on a Machine.** All owners act as one OS
  user; one owner can read or change another's files, instructions, or
  `.mcp.json`. Hub-held state stays owner-scoped.
- **T6. Included SSH configuration.** The safety block fixes host-key
  checking, batch mode, agent, and connection sharing for every hop ssh itself
  opens; the included file's `ProxyCommand`, identities, and `SendEnv` apply as
  written, and a hop a `ProxyCommand` opens is outside the block.
- **T7. Agent widening its own bounds.** Accepted for the experiment: roots
  are an addressing convenience the Machine user can change; disclosed to the
  model and the operator.
- **T8. Untrusted Machine input.** Every daemon-supplied field is bounded;
  stream ids are never reused; host-key mismatch is reported as such.
- **T9. Shared-box denial of service.** Per-stream credits and per-session caps
  bound the pipe; process and memory exhaustion on the box remain the
  operator's responsibility.
- **T10. Whole-tool allows reach every Machine.** The recommended portable
  policy allows `read`, `edit`, `write`, and `bash` for every path, so
  configuring Machines exposes every registered root to every eligible user;
  the operator page gives Machine-scoped allows and root-anchored reject
  equivalents.

## Risks / Trade-offs

- [No NAT traversal] → A Machine needs an SSH-reachable first hop.
- [Shells per worker session] → One shell per worker per Machine; M workers
  allow M concurrent shells on one Machine.
- [Long builds die on worker drain] → Accepted; matches local behavior.
- [No hop-level diagnosis] → Jump chains live in the included SSH
  configuration, so status reports a reason, not which hop failed.
- [Status freshness] → Up to about 2.5 minutes to report offline; 15 seconds
  of UI staleness.
- [Size] → One implementation layer, re-estimated at 9,000 to 12,000 authored
  lines, against the about-2,000-line budget; an explicit exception by Leo's
  decision, to be split into reviewable layers before shipping. Moved packages
  and `apps/machine` fall outside the current mutation matrix unless it is
  extended.

## Migration Plan

Additive: one new table, one nullable `chats` column, an optional config
section. Without `machines`, nothing changes. Rollback removes the section;
Chats bound to a Machine detach as `executor_absent` on their next Run.

## Open Questions

- Probe and inactivity intervals, tuned during the experiment.
- Whether `machines_status` moves to the presence shape a dial-out transport
  needs; additive either way.
