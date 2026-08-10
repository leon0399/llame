## Context

See `proposal.md — Why` for motivation and the delta specs for normative behavior.
This design is constrained by five shipped facts:

1. Tool declarations are already immutable JSON-Schema contracts bound to a Run,
   and execution rebinds those contracts to trusted live executors.
2. `tools.allowed` is a restart-applied instance policy. It is currently strict
   against the code-owned registry and defaults empty.
3. The API process resolves and snapshots a turn before enqueue, while a dedicated
   worker may execute it in another process. MCP sessions therefore cannot be shared
   between availability resolution and execution.
4. The triggering user message, Run, and effective-context snapshot are already
   committed atomically, and the context builder already renders trusted semantic
   model-switch metadata before visible user text.
5. `@ai-sdk/mcp` is not installed. The compatible line for the repo's `ai@6.0.217`
   is `@ai-sdk/mcp@1.x`; `1.0.67` supports the session-capable Streamable HTTP era
   through protocol `2025-11-25`, not the sessionless `2026-07-28` revision. Its
   current converter does not paginate discovery, its requests have no default
   deadline, and its HTTP transport follows redirects unless told otherwise.

The remote endpoint is operator-configured, not tenant-controlled. It may legitimately
be on a private network, so this change does not add an IP/DNS denylist. User content
and tool arguments do cross that operator-approved trust boundary.

## Goals / Non-Goals

**Goals:**

- Add the smallest second tool source that preserves the existing immutable
  declaration/executor boundary.
- Make availability truthful at turn binding and make execution safe when API and
  worker process state diverge.
- Keep connection failures local to one server and secret-bearing data out of every
  durable or model-facing failure path.
- Make availability metadata reusable by code-owned tools and later sources without
  building a plugin framework.

**Non-Goals:**

- Sharing or resuming MCP sessions across processes or restarts.
- MCP `2026-07-28` sessionless requests, modern-first protocol negotiation, list TTLs,
  or subscription-based catalog invalidation. They require a stable compatible client
  and are a separate transport follow-up.
- User/account-scoped MCP configuration, lazy connection activation, idle eviction,
  or cross-process ownership. The source-neutral catalog must not preclude that future
  lifecycle, but this change does not implement its pool.
- Hot-reloading configuration, user-managed endpoints, OAuth, a management UI, or a
  readiness/health API.
- MCP resources, prompts, sampling, notifications, stdio, legacy SSE, or write-capable
  tools.
- Verifying that a remote operation is semantically read-only. In this slice, placing
  an MCP id in `tools.allowed` is the operator's explicit read-only attestation.

## Decisions

### D1. One narrow turn-catalog value composes sources; no generic plugin system

Introduce a source-neutral `TurnToolCatalog` value with two projections:

- admitted executable candidates, carrying source identity and canonical declaration;
- an availability manifest for ids eligible under `tools.allowed`.

The existing code-owned registry and one `McpToolSource` feed a small composition
service. Admission, canonicalization, hashing, and allowlisting remain shared after
composition. Source-specific connection state does not leak into the runner.

The manifest is versioned and sorted by tool id. Each eligible entry is either
`available` with its canonical declaration hash or `unavailable` with one closed
reason code. The initial reason vocabulary is `source_connecting`,
`source_disconnected`, `protocol_unsupported`, `discovery_failed`, `tool_missing`,
`declaration_refused`, and `name_collision`; renderers map those codes to static
prose.

**Alternative — add a general provider/plugin SPI:** rejected. There are two sources
and one composition operation. Lifecycle hooks, capability negotiation, and arbitrary
source registration would be speculative surface.

**Alternative — keep passing raw registries into each resolver:** rejected. A second
source now has independent availability state that must be identical in snapshot,
receipt, reminder, and execution binding. Reassembling it independently would create
drift.

### D2. Configuration follows the portable named-object shape; the allowlist is also the read-only attestation

Add a top-level `mcpServers` object mapping server names to closed
`{ type, url, headers? }` entries. This deliberately follows Claude-compatible
`.mcp.json`; VS Code uses the same named-object/entry shape under `servers`. Accept
`type: "http"` and `type: "streamable-http"` as aliases, but implement only MCP
Streamable HTTP—no VS Code-style fallback to legacy SSE. Retaining `mcpServers` rather
than also accepting `servers` gives llame one canonical key and allows a `.mcp.json`
fragment to be copied without transforming an array.

Server names are unique object keys, use `[A-Za-z0-9_-]`, exclude `__`, and are
length-bounded so the generated name can satisfy active provider constraints. Detect
duplicate JSONC properties before ordinary object parsing can overwrite them. URLs are
absolute `http`/`https`. Header values use llame's existing one-pass `{env:…}` /
`{path:…}` interpolation and are retained only in the resolved private config; this
change adopts the interoperable structure, not a second interpolation language.

Reject transport-owned headers case-insensitively, including `Accept`, `Content-Type`,
`MCP-Protocol-Version`, `MCP-Session-Id`, and `Last-Event-ID`. Reject two configured
header names that collide under ASCII case-folding before the Fetch `Headers` layer can
merge or overwrite them. Pass `redirect: "error"` explicitly. Do not ban loopback or
private addresses: only the operator can set the endpoint, and self-hosted local MCP
servers are a primary use case.

Boot validation remains strict for code-owned ids. An id matching
`mcp__<configured-server>__<tool>` may survive discovery failure, but malformed ids or
ids naming an undeclared server fail startup. Such an id is fail-closed until exact
discovery succeeds. An MCP annotation or description never affects classification;
the exact allowlist entry is the operator-controlled authorization and read-only
attestation.

`tools.allowed` is restart-applied policy and is bound into the immutable Run snapshot
when the user turn is accepted. A later configuration removal applies to newly accepted
Runs; it does not retroactively reauthorize or rebind an already accepted Run or its
queue retries. Immediate revocation is part of the future permission-policy work, not a
hidden live read of mutable config in this capability. That limitation is acceptable
only under this change's explicit read-only/idempotent tool boundary.

**Alternative — use `tools.mcpServers[]` with an `id` field:** rejected. It is easier
to validate internally but incompatible with the named-object shape operators already
copy from `.mcp.json` and VS Code.

**Alternative — accept both top-level `mcpServers` and `servers`:** rejected. The
ecosystem has two host-specific top-level names but no protocol standard; dual aliases
create precedence and duplicate-definition ambiguity. `mcpServers` is the established
portable `.mcp.json` spelling.

**Alternative — await remote discovery during boot and validate every id:** rejected.
It converts a remote outage into total instance downtime.

**Alternative — trust MCP `readOnlyHint`:** rejected. It is remote-authored metadata,
not an authorization boundary.

### D3. Pin the AI SDK v6 MCP client, but use its raw protocol operations

Add `@ai-sdk/mcp` on the `1.x` line compatible with `ai@6.0.217`, pinned through the
workspace catalog and lockfile. Use its Streamable HTTP client and public `listTools`
operation for raw paginated discovery. After llame sanitizes and admits the complete
definition set, use `toolsFromDefinitions` only to obtain the package's protocol call
closures; wrap those closures with llame's already-compiled validators, canonical
declarations, names, classification, result mapping, redaction, and executor binding.
Do not use its convenience `tools()` discovery, which reads only one page and would
make the package's converted declaration—not llame's admitted declaration—the contract.

The adapter applies one fixed, non-configurable v1 inbound transport cap to every MCP
operation: 1 MiB per non-streaming response body or SSE event before JSON/JSON-RPC
parsing. It enforces that cap while consuming bytes rather than trusting
`Content-Length` alone.

Discovery follows `nextCursor` under additional fixed v1 resource budgets: a 30-second
operation deadline, 8 MiB of response bytes across the operation, 256 tools per page,
1,000 tools total, 256 KiB per serialized raw declaration, schema nesting depth 64, and
4 MiB of serialized declarations retained for the candidate catalog. A hard
1,000-page ceiling and seen-cursor set remain independent loop guards. Any
operation-level budget breach invalidates the whole discovery or refresh and publishes
no partial catalog; an individual declaration that exceeds only its declaration/depth
admission budget is refused like any other malformed tool while valid siblings survive.
No MCP call is automatically retried (`maxRetries: 0`).

**Alternative — use `@modelcontextprotocol/sdk` directly:** rejected. It is currently
present only through a development CLI and would duplicate transport work already
available on the AI SDK v6-compatible line.

**Alternative — use the MCP client's `tools()` result directly:** rejected. That path
does not implement llame's pagination, stable canonicalization, isolation, or trusted
validator requirements. Reusing only `toolsFromDefinitions(...).execute` avoids
reimplementing protocol calls without surrendering the declaration boundary.

The adapter offers protocol `2025-11-25` and may negotiate only the package-supported
session-capable Streamable HTTP revisions `2025-03-26`, `2025-06-18`, and
`2025-11-25`. It does not implement the breaking sessionless `2026-07-28` wire shape
and does not fall back to the deprecated HTTP+SSE transport from `2024-11-05`.
Modern-first negotiation is a separate follow-up once a stable compatible client can
own both eras without llame reimplementing a second transport.

### D4. Each process owns independent per-server clients and atomic catalogs

An `McpRuntimeService` is instantiated in every process that binds or executes Runs:
the HTTP API and both co-located and dedicated worker topologies. It owns one state
record per configured server:

```text
connecting -> ready -> unavailable -> reconnecting -> ready
                                      \-> closing
```

Each record owns at most one client, one in-flight connect/refresh promise, one
immutable admitted catalog, and one lifecycle timer. It also owns a monotonically
increasing generation and exact client identity. Every connect, discovery, refresh,
transport-close, reconnect-timer, and shutdown callback captures both. Before it
publishes or withdraws a catalog, changes lifecycle state, or schedules follow-up work,
it must still match the current record. A stale callback may release only the old
resources it captured; it cannot close the current client or mutate the current
generation. Startup is non-blocking across servers: eager connect/discover jobs run
independently, and failure publishes only that server's unavailable state.

Ready clients run complete discovery periodically in the background with a one-hour
base interval and independently sampled ±20% jitter per server, process, and cycle
(uniformly 48–72 minutes); v1 adds no operator tuning knob. A turn performs no MCP
network I/O: it immediately projects the latest atomically published catalog, even
when a refresh, connect, or reconnect is in flight. Successful refresh atomically
replaces the prior catalog after complete pagination and admission. A transport close
or failed refresh first atomically replaces the server catalog with unavailable
entries, then closes the old client and schedules reconnect in the background.

Reconnect always creates a new client/session and performs complete discovery/admission
before one atomic publish. Reconnect delay uses capped exponential backoff with full
jitter: for zero-based failure attempt `n`, uniformly sample the next delay between
zero and `min(5 minutes, 1 second * 2^n)`. Retry indefinitely while the server remains
configured, reset `n` only after initialization plus complete discovery/admission
succeed, and allow at most one attempt per server in flight. Each connect, discovery,
and refresh request has its own deadline. This intentionally accepts bounded catalog
staleness between background observations rather than putting remote latency on every
user turn. Exact declaration-hash binding still prevents a worker from executing a
different contract than the API snapshotted.

Shutdown cancels timers and pending work, withdraws catalogs, and closes every client
under a bounded aggregate deadline. No client or session is persisted or transferred
between API and worker processes.

**Alternative — centralize MCP clients in the API and proxy worker calls:** rejected.
It couples durable execution back to HTTP process liveness and creates a new private
RPC surface.

**Alternative — persist sessions or catalog TTLs:** rejected. The v1 client cannot
resume a session across instances, and a TTL would knowingly advertise stale tools.

### D5. Naming and external prose are normalized once, before canonicalization

Build ids with one provider-independent algorithm named `mcp-tool-id-v1`; provider
selection is never an input. Keep the configured ASCII server id byte-for-byte. For the
remote tool name, apply Unicode NFKC, replace each maximal run outside ASCII
`[A-Za-z0-9_-]` with `_`, trim leading/trailing `_`, and preserve ASCII letter case.
The final id is `mcp__<server-id>__<normalized-tool-name>` and may contain at most 64
ASCII characters. Reject an empty normalized tool segment or an overlength id. Detect
collisions across the whole composed catalog under ASCII case-folding, including two
source names mapping to one id, and refuse every member of the colliding set. Never
truncate, hash-suffix, or add an ordinal/discovery-order suffix. `mcp-tool-id-v1` is part
of the observed v1 availability-manifest semantics; a future mapping change therefore
requires a new manifest version and an explicit migration rather than silently
reinterpreting allowlist entries. Startup allowlist parsing uses this exact grammar,
length rule, server-id lookup, and canonical tool-segment check.

Descriptions and every recursive JSON-Schema `description` value pass through the
existing tag-balance authored-text sanitizer extended with the reserved structural
names used by runtime reminders and tool-output labelling. The sanitized declaration
is the only declaration admitted, validated, hashed, snapshotted, receipted, and sent
to providers. Raw remote prose remains ephemeral.

**Alternative — escape only while rendering receipts/prompts:** rejected. Different
consumers would then hash and execute different contracts, and poisoned prose could
reach the provider before rendering.

**Alternative — strip all markup:** rejected. It destroys legitimate self-contained
documentation without improving the structural boundary beyond the existing
balance-and-reservation rule.

### D6. Availability state is part of the immutable effective context

Add non-null versioned `tool_availability_manifest` JSONB and `availability_hash`
columns to `model_context_snapshots`. `availability_hash` uses its own domain-separated
hash over the canonical manifest. Preserve the existing `content_hash` definition
(rendered prompt plus advertised declarations) and `tool_hash` definition (advertised
declarations only), so historical receipts remain truthful. Replace the owner/content/
source reuse key with owner/content/availability/source; reuse therefore occurs only
when prompt, declarations, source, and availability are all equal.

Historical snapshots predate availability observation. Backfill them with one explicit
canonical legacy/unobserved sentinel—exactly
`{"version":0,"state":"unobserved"}`—and its domain-separated hash, not an
ordinary observed empty v1 manifest. V0 has no `entries` field. The first comparison
against that sentinel follows initial baseline semantics: disclose only currently
eligible unavailable tools and do not fabricate Added entries for healthy tools. Every
newly authored snapshot uses an observed v1 manifest with `entries`, including a
legitimately empty array. Observation state must therefore be explicit; an empty v1
entries array cannot distinguish migration history from a real observed empty toolset.

The owner receipt exposes the availability hash and manifest version. For v0 it reports
only `state: "unobserved"`; it never renders v0 as an empty catalog. For v1 it exposes
only ids, states, declaration hashes, and static labels. It does not expose source URLs,
header names/values, session ids, remote text, or process diagnostics.

The API resolves personalization and the turn catalog before opening the existing
tenant transaction. Inside that transaction it reads the most recent prior Run
snapshot, derives availability metadata, inserts the user message, creates/reuses the
snapshot, and creates the Run. The Run id is allocated before insert so the semantic
part can bind to it. Queue retries never recompute this state.

As with model-switch detection, prior Run status is irrelevant after that transaction
commits. A failed, cancelled, or expired Run still records the availability observed
for its accepted user turn, and that user message plus its semantic part remains in
portable history for the next Run. A later compaction starts a new model-facing
availability disclosure epoch under D7 without resetting this persisted runtime
history. A failure before the transaction commits creates no Run or baseline.

**Alternative — store availability only on the message:** rejected. Execution and
receipts could no longer prove which state produced the advertised toolset.

**Alternative — redefine `content_hash` to include availability:** rejected. Existing
immutable snapshots and owner receipts already expose that hash as prompt-plus-tools;
backfilling a manifest without exactly rehashing every historical JSON value would make
the receipt lie, while rehashing would mutate immutable receipt identity. A separate
domain hash preserves both meanings.

**Alternative — include unavailable declarations in `tool_hash`:** rejected. They were
not advertised and cannot be executed; doing so changes the hash's established
contract.

### D7. Reuse the model-change semantic-part pipeline, not the part type

Add a strict server-authored `data-tool-availability` part parallel to
`data-model-context`. Reuse the same three mechanisms:

1. strip client-authored semantic parts at ingestion;
2. persist validated structured metadata rather than generated prose;
3. render canonical text in `ContextBuilder` immediately before the triggering user
   text.

Do not overload `data-model-context`; model identity and tool availability have
different schemas, visibility, and evolution. When both occur, render model-change,
then tool-availability, then user text in one user message after the system prompt.

For later turns, compare the current and most recent prior manifest as a three-state
machine (`absent`, `available`, `unavailable`). Each changed id appears in exactly one
group:

- `Added tools`: absent before, available now;
- `Removed tools`: available or unavailable before, absent now;
- `Unavailable tools`: absent before, eligible but unavailable now;
- `Became unavailable`: available before, unavailable now;
- `Now available`: unavailable before, available now.

Empty groups are omitted and order is fixed as above. An id can never appear under
`Added tools` unless it is callable in the current Run; a newly eligible id whose
source is already unavailable appears only under `Unavailable tools`. Unavailability
and recovery reasons are closed codes rendered to static strings such as `server
disconnected` and `server reconnected`; remote strings never enter the part. If a
declaration changes while the same id stays available, the new provider declaration
and declaration hash are sufficient—this is contract drift, not an availability
transition. A disconnect and full recovery between snapshots produces no reminder.

On the first turn of a model-facing availability disclosure epoch, emit only a
degraded-state baseline when eligible ids are unavailable. A fresh conversation starts
the first epoch; every newly active compaction checkpoint starts another. Currently
callable tools are already advertised through the provider's native declarations on
every request and are not repeated in prose. The degraded baseline uses the exact
heading `Unavailable tools:` rather than claiming a transition. If every eligible tool
is available, native declarations are sufficient and no reminder is emitted.

Compaction resets only the model-facing comparison baseline. It does not reset MCP
clients, catalogs, reconnect backoff, immutable Run manifests, or any other runtime or
persisted state. The first accepted turn after a checkpoint therefore does not compare
against a pre-compaction manifest or emit Added/Removed/Became unavailable/Now
available groups; it follows the same initial semantics as a fresh conversation.
Subsequent turns compare against the preceding accepted turn within that disclosure
epoch and emit a delta only when observable state changes. An unchanged healthy state
and an unchanged outage both emit nothing.

A semantic compaction summary may preserve a prior tool outage, recovery, or failure
when it mattered to the conversation. Such statements are historical context, not a
current availability source. The current request's provider-native declarations and,
when degraded, its current `Unavailable tools:` baseline establish present
callability. Every emitted reminder ends with: `Do not simulate removed or unavailable
tools or invent their results.`

Old parts remain in immutable history until their messages are compacted. The chat
loop uses the active compaction boundary to detect the first accepted turn of a new
disclosure epoch; no per-tool summary inspection, per-turn outage heartbeat, or mutable
global reminder state is introduced. Public shares, ordinary exports, and search
projections discard both the semantic part and rendered reminder.

**Alternative — create another system message:** rejected. The context has one
operator system prompt, while this state is turn-relative and must remain attached to
the user action that observed it.

**Alternative — persist literal XML-like prose:** rejected. It duplicates a render
format into durable state and weakens validation/forgery resistance.

### D8. A dynamic Run binds the declaration but resolves the executor locally

The API snapshot is authoritative for what the model may see. At execution, each
process resolves every snapshotted declaration against its own live catalog by id and
canonical declaration hash:

- a matching dynamic declaration binds its current executor;
- a missing, disconnected, or changed dynamic declaration binds an unavailable
  executor while preserving the snapshotted declaration;
- a missing or changed code-owned declaration remains a Run-level integrity failure.

The unavailable executor returns the existing structured non-fatal tool error with a
closed `not_available` outcome. It never substitutes a newer declaration or another
tool. The AI SDK therefore receives exactly the snapshotted tool contract, and an
unaffected or answer-only Run continues even when API and worker MCP states differ.

Remote calls receive the existing composed Run/call abort signal and timeout. Calls
have no automatic retry because even an operator-attested read may be expensive or
observably duplicated. MCP success/error content is mapped deterministically into the
existing portable result envelope before normal persistence, stream, replay, and size
budget handling.

Call settlement and server lifecycle are separate decisions. During a tool call, a
network disconnect, HTTP `401`/`403`, HTTP `404` carrying an established MCP session,
or malformed transport/JSON-RPC response settles the current call non-fatally,
atomically withdraws that process's server catalog, and starts the normal background
reconnect path. HTTP `429`, `5xx`, all other valid `4xx` responses (including `410`), a
valid tool-level MCP error, `CallToolResult.isError`, invalid tool output, or per-call
timeout settles only that call; the server remains ready and no availability
transition is manufactured. A Run or caller cancellation likewise changes no server
state.

Any HTTP failure during initialization, discovery, or background refresh makes that
server unavailable and enters the same reconnect path because no complete catalog can
be published or retained after a failed control-plane operation. `410` has no terminal
meaning in this capability. Error bodies never determine the category; classification
uses trusted operation stage, transport status, session presence, and protocol
structure before redaction.

**Alternative — omit a disappeared tool from the provider request:** rejected. That
would make execution differ from the immutable effective-context receipt.

**Alternative — fail the Run on dynamic drift as for code-owned tools:** rejected.
Upstream schema changes and process-local disconnects are ordinary dynamic-source
behavior, not evidence of a broken deployment.

**Alternative — reconnect after every failed or slow call:** rejected. Tool/application
failure and latency do not prove transport loss; withdrawing healthy sibling tools
would amplify one operation's failure into a server-wide outage.

### D9. Redact at the remote boundary before any serializer or logger

The resolved MCP config produces a private per-server redaction set containing all
non-empty resolved header values, ordered longest-first. Raw call arguments exist only
long enough to invoke the transport. Raw results and exceptions exist only inside the
boundary adapter. Before any argument, result, or error enters a logger, diagnostic,
event, durable row, receipt, model result, or test snapshot, recursively replace every
configured value in strings with one fixed marker. For every non-string JSON scalar,
compare its canonical JSON scalar spelling against the configured values and replace an
exact match with the same JSON-string marker; thus a header value `123`, `true`, or
`null` cannot escape when a server echoes it as the corresponding JSON scalar. This
security transformation intentionally changes the type of a matching scalar leaf. It
preserves object/array container topology and keys, but secrecy takes precedence over
the remote output schema's leaf-type fidelity. Redaction runs before serialization and
before the existing result-size truncation.

Transport exceptions map directly to closed internal categories; do not persist or
model-display `MCPClientError.message`, response bodies, headers, URLs, or session ids.
Structured results retain their container topology and keys while matching leaves are
redacted as above. Tests use sentinel credentials and assert their absence across logs,
events, messages, receipts, and provider input.

**Alternative — redact logs only:** rejected. The larger leak surface is durable tool
arguments/results replayed to later model calls.

**Alternative — retain raw remote errors for debugging:** rejected. Operator
diagnostics need server id and closed failure class, not credential-bearing bodies.

### D10. Acceptance uses one deterministic protocol fixture and one opt-in live eval

Ship a local Streamable HTTP fixture that can script pagination, malformed schemas,
calls, delayed responses, disconnects, reconnects, cursor loops, and close behavior.
Use it for unit and integration tests; do not mock the MCP client for lifecycle
acceptance. Browser E2E configures the fixture as a generic search server, proves an
ordinary chat uses sourced output, and reloads the page to prove durable tool replay.

A separate environment-gated eval may target a real web-search MCP service. Missing
credentials are an explicit opt-out for that eval only; deterministic acceptance never
skips. Test reporters and failure snapshots use sentinel redaction assertions so a
failed eval cannot print the credential.

**Alternative — make one vendor the feature contract:** rejected. Web search is the
acceptance case; Streamable HTTP MCP is the product boundary.

## Stack Plan

Land this spec-only prerequisite first, then implement it as four dependent layers:

```text
(master)
  <- mcp-tools/spec
  <- mcp-tools/availability
  <- mcp-tools/client
  <- mcp-tools/runtime
  <- mcp-tools/enable
```

The spec PR contains only this OpenSpec change and establishes the reviewable contract
before implementation. Each implementation layer above it is independently green and
safe to merge. Lower layers do not accept an operator MCP configuration before the
complete execution path exists. Deployment is revision-coordinated across API and
workers: implementation PR 1 introduces a new persisted semantic part old workers
cannot render, and implementation PR 4 introduces dynamic declarations old workers
cannot bind. Mixed-revision API/worker operation is not claimed for those layers.

### PR 1 — `mcp-tools/availability`: source-neutral runtime availability

Land the source-neutral turn catalog/manifest for the existing code-owned registry,
the snapshot migration/separate-hash/receipt changes, trusted semantic availability
parts,
delta/current-outage rendering, model-reminder ordering, compaction behavior, and
private-projection exclusions. No MCP dependency or configuration exists yet.

This PR may visibly report a code-owned tool added/removed across restart-applied
allowlist changes, but does not change what can execute. It requires workers capable
of rendering the new semantic part to be deployed before the API can author it.

### PR 2 — `mcp-tools/client`: inert protocol and security adapter

Add the pinned MCP dependency, deterministic fixture, direct `McpServerClient`, raw
paginated discovery, naming/admission/neutralization, call/result mapping, redaction,
timeouts, redirect refusal, and bounded close. Construct it directly in tests only;
do not add `mcpServers` to public config or wire a production client.

This makes the protocol/security boundary reviewable without database or queue noise.
Merging it alone adds inert code and a dependency, not network behavior.

### PR 3 — `mcp-tools/runtime`: process-local lifecycle and dynamic binding

Add the multi-server runtime manager, reconnect/withdraw/refresh behavior, dynamic
source composition, exact-hash executor binding, unavailable executors, and API plus
co-located/dedicated-worker module wiring. Production wiring supplies an empty server
map until PR 4; tests inject explicit server definitions directly.

This isolates the concurrency and API/worker split from operator configuration. Merged
alone, it preserves the shipped code-owned toolset and performs no outbound connection.

### PR 4 — `mcp-tools/enable`: expose and prove the complete feature

Add the top-level portable `mcpServers` config schema, split allowlist validation, and
the adapter from resolved instance config into the already-wired runtime. Ship full
integration/browser/optional-live acceptance plus README/SPEC/operator docs, ROADMAP,
CHANGELOG, and OpenSpec archive/sync updates here. This is the only layer that enables
operator-configured outbound MCP traffic, so documentation and acceptance cannot land
after the feature.

Create the stack before implementation, commit only each layer's owned files/changes,
and use `gh stack rebase --upstack` after any lower-layer repair. Do not split by
"implementation versus tests": each PR carries its own failing-first tests and
verification.

## Risks / Trade-offs

- **[Background observation can lag a silent remote catalog change]** → Eagerly keep
  instance clients resident, run complete refreshes every 48–72 minutes from a
  one-hour base, atomically publish only complete catalogs, and retain exact-hash
  worker binding. Turns never wait on remote catalog I/O; bounded observation lag is
  explicit.
- **[API and worker observe different remote states]** → Snapshot declarations in the
  API and bind only exact hashes in the worker; mismatch becomes a local unavailable
  observation.
- **[An old worker ignores a semantic availability part authored by a new API]** → PR 1
  and PR 4 require coordinated API/worker rollout: apply the additive migration, drain
  old consumers, deploy new workers, then allow the matching API to accept turns. Do
  not claim mixed-revision compatibility.
- **[An operator allowlists a tool that is not actually read-only]** → Treat the
  allowlist as an explicit attestation and document the egress/retry consequences.
  Automated semantic verification is impossible; write tools remain prohibited by
  contract.
- **[A configured endpoint can access private infrastructure or exfiltrate prompt-derived
  arguments]** → Only restart-applied operator config can add it, redirects are
  disabled, and no tenant/auth datastore context is passed. This is still an explicit
  operator-approved egress boundary, not a sandbox.
- **[Exact-value redaction can over-redact common short header values, change matching
  scalar leaf types, and cannot catch transformed secrets]** → Treat all configured
  values conservatively, compare direct string and typed-scalar echoes before
  serialization, preserve container topology, never persist raw transport errors, and
  test structured payloads. Do not claim arbitrary encoding detection.
- **[The v1 MCP client does not surface tool-list change notifications]** → Run
  complete discovery periodically in the background with jitter. Reconnect also
  requires full discovery; a later modern-protocol adapter may replace polling with
  TTL/subscription invalidation without changing turn binding.
- **[Repeated outage reminders consume context]** → Emit only ids plus static reasons
  on a degraded disclosure-epoch baseline or an actual within-epoch state transition.
  Never emit an unchanged per-turn outage heartbeat.
- **[A 1,000-page cap permits a large catalog]** → Admission exposes only allowlisted
  ids, discovery is deadline-bounded, and the cap prevents an infinite cursor loop.

## Migration Plan

1. Merge PR 1 first. Apply its generated migration, which backfills existing snapshots
   with exact canonical JSON `{"version":0,"state":"unobserved"}` and its
   precomputed domain-separated availability hash, makes both columns non-null, and
   replaces the reuse unique index to include the new hash. The sentinel has no
   `entries` field and is distinct from every observed v1 manifest, including one with
   an empty `entries` array. Historical `content_hash` values remain unchanged and
   truthful. Then drain old consumers, deploy PR 1 workers, and only then deploy/enable
   the PR 1 API to author availability parts; old workers cannot render that new
   persisted semantic part.
2. PRs 2 and 3 are deployment-inert: they expose neither configuration nor outbound
   clients. They may merge and deploy without operator action.
3. Before deploying PR 4, keep `mcpServers` empty, drain old workers, deploy PR 4
   workers, then deploy the matching API. This prevents an old worker from claiming a
   dynamic-tool Run.
4. Add one allowlisted fixture/real read-only server and restart all processes together.
   Verify receipt, disconnect/reconnect reminder, tool execution, refresh replay, and
   secret-absence evidence before enabling additional servers.

Rollback starts by removing MCP ids/server entries and restarting all processes, then
draining dynamic-tool Runs before reverting binaries. The additive manifest column and
old semantic parts may remain; deleting them is unnecessary and would make rollback
destructive. A later forward migration may remove the column only after every retained
Run/snapshot that references it is outside the product retention window.

## Open Questions

None.
