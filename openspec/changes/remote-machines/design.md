# Design

## Context

See proposal.md for motivation. Current state that shapes the approach:

- Native tools execute in the worker process. `executeNative` and
  `executeLocator` in `apps/api/src/tools/native-files.ts` are the only scheme
  table (`kb://`, `skill://`, `media://`, web); `executeNativeBound` records the
  durable native attempt keyed by Run, executor, and tool call. `kb://`
  mutations use an unbound fence, which is the model for Machine mutations.
- `packages/native-file-tools` and `packages/bash-executor` have no NestJS or
  database dependency. `bash-executor` spawns detached process groups and caps
  concurrency with a module-level `maxProcesses: 1`.
- The Workspace binding is `chats.workspace_root`, `workspace_executor_id`,
  `workspace_generation`, with six DB-checked detach reasons. Run preparation
  compares the bound executor with `tools.nativeExecutorId`.
- Workspace MCP clients are keyed by `{chatId, root, generation}`.
  `McpServerClient.connectStdio` calls `createStdioTransport` directly; the MCP
  SDK `Transport` interface (`@modelcontextprotocol/sdk` 1.31.0) is
  message-level and is the seam.
- Instruction files read through the native `read` tool; the skill catalog
  reads through a local `SkillCatalogFileSystem`.
- Permission projection (`tools/permissions/locator-projection.ts`)
  canonicalizes file, `kb://`, `skill://`, and web locators and passes other
  schemes verbatim.
- Live updates are owner-routed only. The one operator-wide, non-RLS table
  precedent is `embedding_model_bindings`.

Decision provenance is the grilling record behind the
[multi-device placement study](../../../docs/research/product-vision/2026-10-18-multi-device-execution-placement.md).

## Goals / Non-Goals

**Goals:**

- One remote path that reuses the local tool implementations byte for byte.
- No new listener, broker, or mailbox: workers dial Machines directly, so
  co-located and split topologies behave the same.
- Hub credentials never leave the hub; Machine credentials never leave the
  Machine except as redaction inputs.

**Non-Goals:**

- A second authentication system: SSH authenticates both ends.
- Durable delivery of tool calls, call re-attach, or a Machine-side ledger.
- Generalizing locator dispatch into an adapter framework (#1011 owns that
  question).

## Decisions

### D1. SSH is the only transport

Workers run `ssh -T -a -x -o BatchMode=yes -o StrictHostKeyChecking=yes
-o UserKnownHostsFile=<pinned> -o IdentitiesOnly=yes -i <identity>
[-J jump1,jump2] <destination> llame-machine serve --stdio` and speak the
protocol over the child's stdio. SSH supplies mutual authentication,
encryption, and multi-hop routing; the operator restricts the hub key on the
box with `restrict,command="llame-machine serve --stdio"` and on jump hosts
with `restrict,port-forwarding,permitopen=...`.

Alternatives: a dial-out WebSocket from the Machine (needs enrollment, mutual
auth, relay design, and cross-process routing to the API holding the socket);
workers accepting inbound Machine connections (adds ingress to workers). Both
remain possible later as additional transports for the same protocol.

### D2. Protocol: newline-delimited JSON frames with stream ids

Frame: `{ "s": <stream>, "m": <JSON-RPC 2.0 message> }`. Stream 0 carries the
handshake (`hello` with protocol version and daemon version) and session
control; each tool call or MCP channel opens its own stream. Methods:

| Method                                                           | Purpose                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `roots.list`                                                     | registered roots                                                     |
| `fs.read`, `fs.edit`, `fs.write`                                 | `native-file-tools` entry points with the same arguments and results |
| `proc.bash`, `proc.cancel`                                       | `executeManagedBash` with Machine `cwd` and additive `env`           |
| `mcp.servers`                                                    | Workspace MCP config read and resolved on the Machine                |
| `mcp.open`, `mcp.message`, `mcp.close`, `mcp.setProtocolVersion` | relay one server's JSON-RPC messages                                 |

Every request carries `{runId, attemptId, toolCallId, deliverySeq, deadline}`.
Message size caps reuse the bounded stdio framing (1 MiB). Types live in a
shared protocol package so both sides compile against one definition.

Alternative: one SSH session per operation or channel (simpler framing; one
SSH handshake per call over two jumps is hundreds of milliseconds).

### D3. Session manager in each worker

One SSH session per worker per Machine, opened on first use, kept while any
stream is open, closed after five idle minutes. Session start, handshake
result, and failures update Machine status. When the child exits, every open
stream fails: tool calls settle by the native fence rules, MCP channels close.
The daemon terminates every process group it started when its stdin closes,
which implements caller-loss termination.

### D4. Locator and fence integration

`executeLocator` gains a `machine` branch that parses `machine://`, resolves
the configured Machine, and dispatches through the session manager. Reads use
no fence; `edit`, `write`, and Machine `bash` use the existing native attempt
with an unbound fence, as `kb://` mutations do, so no local executor binding is
created. Media bytes return from the daemon under the existing media size cap
and enter the hub's existing preparation path.

### D5. Workspace binding and offline state

A Machine Workspace stores `workspace_root = machine://<name>/<canonical path>`
and `workspace_executor_id = machine:<name>`. Preparation skips the local
executor comparison for `machine:` executors and instead checks that the name
is still configured (else detach `executor_absent`, an existing reason). When
the Machine is unreachable, preparation keeps the binding and emits a
`workspace` context transition marked unavailable; root checks run when the
Machine is reachable and use the existing `root_missing` and `root_moved`
reasons. No new detach reason, so no migration on `chats`.

### D6. Workspace MCP through a relayed transport

`McpServerClient` gains a constructor path that accepts an SDK `Transport`
instead of always calling `createStdioTransport`. `MachineTransport` implements
`start`, `send`, `close`, `onmessage`, `onclose`, `onerror`, and
`setProtocolVersion` over an `mcp.*` stream. On the Machine, the daemon builds
the SDK's own `StdioClientTransport` or `StreamableHTTPClientTransport` from
the config entry it read and pipes messages. `workspace-mcp-config.ts`, the
bounded stdio framing, and `mcp-bounded-fetch.ts` move to shared packages so
the daemon parses, interpolates, and bounds exactly as the hub does.
`mcp.servers` returns server names, transport kinds, states, diagnostics, and
the protected values the hub's redactor needs. The client key adds the executor
id. SSE resumption tokens are not relayed; a lost channel ends the session.

Alternative: run the MCP client on the Machine and expose discovered tools
(duplicates discovery, admission, and redaction; the hub would trust
Machine-reported declarations).

### D7. Instruction files and skills through Machine ports

The instruction loader already reads through the native `read` tool, so it
receives Machine locators for a Machine root. The skill catalog gets a
`SkillCatalogFileSystem` implementation backed by `fs.read` listings and reads.

### D8. Permission projection

`projectNativeFilePath` and `withoutReadSelector` gain a `machine://` branch
producing `machine://<lowercase name><submitted absolute path text>` with
`.`/`..` and trailing separators preserved, matching the direct host-path
rule. `bash` `cwd` and Workspace-relative projection emit the same canonical
text when bound to a Machine.

### D9. Status table, probe, and API

Table `machines_status` (name primary key, first and last contact, last
failure time, reason, failing hop, hub and daemon protocol versions, daemon
version, roots, updated time), operator-wide with no RLS following
`embedding_model_bindings`, written only by server processes and read under
the public role. Rows for names no longer configured are ignored and pruned.
A pg-boss scheduled job probes every configured Machine every 30 seconds
(pg-boss elects one scheduler), and every session start or failure also
writes status, so status needs no new long-lived loop. Status is derived at
read time: online when last contact is within 90 seconds and after the last
failure. The failing hop comes from recognized `ssh` stderr lines; otherwise
it is null. `GET /api/v1/machines` serves the list to authenticated users.

### D10. Web

A read-only Machines section in settings and a Machine state in
`workspace-indicator.tsx`, both refreshed by polling the list endpoint every
15 seconds while visible. Owner-routed live updates do not fit operator-wide
rows, and a broadcast kind is not justified for an experimental surface.

### D11. Daemon

`apps/machine`, TypeScript on Node 22, built to `dist/` with a `bin` entry
`llame-machine` (the repository's first). Commands: `serve --stdio`,
`roots add <dir>`, `roots remove <dir>`, `roots list`. Roots are stored in
`$XDG_CONFIG_HOME/llame-machine/roots.json` as canonical paths. Every path
argument is realpath-resolved and checked against the roots before use.
Installation is manual for the experiment.

### D12. Configuration

```jsonc
{
  "machines": {
    "ssh": {
      "identityFile": "/etc/llame/machine_ed25519",
      "knownHostsFile": "/etc/llame/machine_known_hosts",
    },
    "hosts": {
      "devl": { "destination": "me@box", "proxyJump": ["laptop1", "laptop2"] },
    },
  },
}
```

Relative files resolve from the config file. String values accept the existing
`{env:}` and `{path:}` interpolation. The published JSON schema and
`BUILT_IN_DEFAULTS` gain the section.

## Threats

- **T1. Model-addressed remote execution.** VISION says the model never
  chooses native execution. Here the operator chooses which Machines exist and
  which `machine://` text each permission group admits, and the daemon enforces
  registered roots; the model picks only among operator-admitted addresses, the
  same standing it has for absolute local paths today. This is a deliberate,
  experimental extension and is disclosed in tool descriptions.
- **T2. Shared Machine runs repository commands.** Operator-wide Machines plus
  "entry is the trust decision" mean any user allowed to enter a Machine
  Workspace starts that repository's MCP servers as the Machine user. The
  operator page carries the audited-repository warning from the local
  executor.
- **T3. Hub key compromise.** Forced command and `restrict` limit the key to
  starting the daemon and forwarding through jump hosts; registered roots bound
  addresses but not what a started command can do.
- **T4. Hub secrets exfiltration.** Interpolation runs on the Machine, and the
  hub never sends commands, URLs, or headers for Workspace MCP.
- **T5. Cross-owner leakage on a shared Machine.** Owner-scoped bindings,
  clients, attempts, and results are unchanged; a negative test covers user B
  against user A's Machine Workspace.

## Risks / Trade-offs

- [No NAT traversal] → A Machine needs an SSH-reachable first hop; dial-out is
  a later transport.
- [One shell per Machine] → `bash-executor`'s limit serializes shells across
  users; a second call returns the existing process-limit error.
- [Long builds die on worker drain] → Accepted; matches local behavior.
- [Failing-hop detection parses `ssh` stderr] → Best effort; unknown when not
  recognized.
- [Polling status] → Up to 15 seconds stale in the UI.
- [Size] → One implementation layer, estimated at roughly 6,000 to 7,000
  authored lines, exceeds the 2,000-line layer budget; recorded as an explicit
  exception for this experimental change by Leo's decision.

## Migration Plan

Additive: one new table and an optional config section. Without `machines`,
nothing changes. Rollback removes the section; the table is inert, and Chats
bound to a Machine detach as `executor_absent` on their next Run.

## Open Questions

- Exact probe and inactivity intervals, tuned during the experiment.
- Whether `machines_status` later moves to the presence shape needed by a
  dial-out transport; additive either way.
