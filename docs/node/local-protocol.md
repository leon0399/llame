# Personal Node private protocol, version 2

This is the implemented local slice of the module family described in the
product-vision research, not the hosted OpenAPI, MCP, ACP, or a synchronization
protocol. Its transport and framing declarations are in
`packages/personal-node/src/protocol.ts`; runtime parameter validation is in the
service and domain handlers. CLI process-contract tests exercise this boundary.

## Ownership and transport

Ordinary local CLI commands spawn `@workspace/node/server --stdio`, or
attach to an explicitly running `llame node serve` under the same data directory.
The former owns its child lifetime; the latter is a foreground, independently
operable process. The CLI never opens the Node database or executes model tools.
`node serve` is a launcher for the server role, not a second client doing work.

Stdio is inherited private process IPC. Persistent service uses `node.sock`, mode
0600, beneath the owned 0700 data directory. There is no TCP listener, browser
endpoint, network-password default, SSH transport option or remote enrollment.
A local channel is the OS owner's authority; it is not evidence of a human click
and is not protection from compromised same-user programs or root. Third-party
surfaces are trusted local clients and must present their own consent UI.
Windows has only the stdio path in this implementation; persistent Unix sockets
and native processes were tested on Linux, not Windows or macOS.

The independent entrypoint is `apps/node/bin/llame-node.cjs`. Private transport
version 2 rejects round-three version-1 daemons; stop/restart them before upgrade.
Data schema version 2 and existing source state are unchanged by this iteration.

The [shared owner protocol](shared-access.md) has its own core/realm version 1.
Its `core.describe` and four retrieval methods work on this private channel and
the authenticated hosted adapter. Execution/admin remain transport-specific;
HTTP never exposes arbitrary private methods. Neither adapter silently falls
back to the other.

## Framing and negotiation

One UTF-8 JSON-RPC 2.0 object per newline, string request IDs, no batches. Require
`core.hello` before domain requests:

```json
{"jsonrpc":"2.0","id":"hello-1","method":"core.hello","params":{"version":2}}
```

The response identifies `version`, `nodeId`, `principal: local-owner`, transport,
implemented module versions (`core`, `realm`, `execution`, `admin`), capabilities,
SHA-256 identities of the server's configuration path and optional Workspace,
and `synchronization: false`. No `sync` module is advertised. The runtime UUID is
not a signing key, portable owner identity, or cryptographic enrollment.

Requests are limited to 1 MiB, responses and queued output to 12 MiB, active
requests to 16 per connection, accepted IDs to 4096 per connection, and active
socket connections to 16. Reconnect with a new Surface when its ID budget is
exhausted. Slow readers may be disconnected; durable events remain available.
Errors contain a stable application code and exit code, not raw SDK exceptions.
Unknown fields, versions and methods fail closed. Duplicate IDs on one channel
cannot execute a mutation twice. There is **no cross-connection idempotency key**:
inspect uncertain Runs instead of resubmitting an execution after disconnection.

## Implemented modules

`core.hello {version}`, `core.describe {}`, `core.status {}`, and `core.cancel {requestId}` negotiate,
inspect, and cancel a request belonging to the same channel.

`realm.models.list {configIdentity}`, `realm.chats.list {}`,
`realm.chats.read {chatId}`, `realm.conversations.search {query, limit?}`, and
`realm.conversations.read {chatId, messageSeq, offset?, limit?}` serve local state.
The four shared retrieval methods return the versioned observation envelope
specified in [shared access](shared-access.md); the CLI prints its native `data`
plus Node provenance. Other private methods retain their existing results.
Search is literal trigram search over user/assistant visible text, minimum three
characters, maximum ten message hits. It excludes tool observations, system
messages and hidden reasoning. Model-invoked search also excludes its current
Chat. `messageSeq` is Chat-local; immutable message UUIDs anchor returned source
URIs. Numeric sequences are locators, not replicated identity.

`realm.knowledge.list {}`, `realm.knowledge.create {name}`,
`realm.knowledge.get {knowledgeSpaceId}`,
`realm.knowledge.search {query, limit?}`, and
`realm.knowledge.read {knowledgeSpaceId, path, offset?, limit?}` expose bounded
live Markdown spaces. Creation provisions a UUID child beneath the managed root;
no endpoint accepts an arbitrary filesystem root. Equal names remain distinct
resources. Search reports failed-space coverage separately from results and
result truncation. Read offsets are zero-based logical lines. The salvaged
Knowledge adapter renders numbered lines; conversation reads preserve source
text with separate coordinate metadata. Neither operation rewrites source files.

`execution.run {chatId, prompt, model?, native, configIdentity, workspaceIdentity?}`
starts a Run. The configuration path must identify the server's boot configuration.
A native Run additionally needs a matching Workspace identity and the server's
explicit native boot grant. These are checked before resolving model credentials.
Clients can decline native access but cannot expand the server's startup grant.
There is one advancing Run per data directory; another is rejected, not queued.

`execution.runs.list {}`, `execution.runs.get {runId}`,
`execution.runs.events {runId, after?}`, and
`execution.runs.cancel {runId}` inspect and control the Node's Runs. Event pages
contain at most 64 events (also byte-bounded), `hasMore` and a terminal-status
snapshot. Follow by sequence; no token stream is re-submitted to the model.
Cancellation is effective for Runs executing on the contacted server. A different
temporary Node cannot cancel another live process; use a persistent Node for
cross-Surface control, or interrupt the initiating temporary Surface.

`admin.mcp.discover {id?, configIdentity}`, `admin.search.rebuild {}` and
`admin.recover {}` perform explicit operator operations. None is a model tool.
Recovery resolves a proven-dead execution lock and marks stranded Runs interrupted
without replay. It is distinct from CLI `node recover`, which removes a
proven-dead server endpoint. Legacy UI cursor rows remain inert migration data;
new remote cursor checkpoints belong to disposable CLI files, never Node state.

## Events, approvals, disconnection

`execution.output` notifications contain the originating `requestId`, a kind
(`event`, `text`, `notice`) and its value. Protected values are redacted inside
the Node before transport. Approval notifications use
`execution.approval.requested {requestId, approvalId, prompt}`. The initiating
channel alone may call
`execution.approval.decide {approvalId, approved}` once, with a boolean decision.
Another observer, a replay, a string such as `yes`, or model text cannot grant it.

Native actions always request individual approval; CLI non-TTY input denies.
Configured MCP exact-name automatic grants retain their previous independent
semantics. Surface-mediated decisions record a runtime-generated channel ID,
local-owner principal, transport, prompt hash and decision in the Run log, in
addition to the tool's action-specific approval and side-effect events. These
receipts document decisions; replaying them is never an authorization mechanism.

A temporary stdio Node cancels on EOF. A persistent Node continues after terminal
loss, but pending/future Surface approvals resolve to denial; it does not leave
unattended writes waiting forever or let a new observer take over the grant.
Explicit Ctrl-C cancellation and `runs cancel` differ from disconnection. Stopping
the server cancels its active work. Executor death needs explicit recovery;
there is no automatic restart/retry/resume of an uncertain side effect.
