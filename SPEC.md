# llame current architecture

**Status:** Current cross-cutting contract. Updated 2026-09-05.

This file records system boundaries and invariants that span capabilities. It is not a future feature inventory, release plan, API catalogue, schema sketch, or research report.

## 0. Document authority

| Question                        | Source of truth                                               |
| ------------------------------- | ------------------------------------------------------------- |
| What llame is and what runs now | [README.md](README.md)                                        |
| Product direction and deferrals | [VISION.md](VISION.md)                                        |
| Sequenced unshipped work        | [ROADMAP.md](ROADMAP.md) and linked GitHub issues             |
| Shipped history                 | [CHANGELOG.md](CHANGELOG.md)                                  |
| Cross-cutting architecture      | This file                                                     |
| Shipped capability behavior     | [`openspec/specs`](openspec/specs)                            |
| Proposed capability changes     | [`openspec/changes`](openspec/changes)                        |
| Database shape                  | [`apps/api/src/db`](apps/api/src/db) and generated migrations |
| API contract                    | Code-first OpenAPI served by `apps/api`                       |
| Research and alternatives       | [`docs/research`](docs/research)                              |
| Contributor rules               | [AGENTS.md](AGENTS.md) and child `AGENTS.md` files            |

When prose conflicts with code or a capability spec, treat the prose as stale and repair it with the behavior change.

## 1. Product boundary

llame currently provides authenticated multi-user chat, durable agentic Runs, operator-configured models, owner-only Projects, hybrid chat search, owner-scoped personal Markdown Knowledge reads, and a bounded read-only tool loop over native, Knowledge, and operator-configured remote MCP tools.

A Project currently groups one owner's Chats. It does not grant shared membership, own knowledge, attach tools, or provide a filesystem workspace. See [`openspec/specs/projects`](openspec/specs/projects/spec.md).

Future behavior belongs in [VISION.md](VISION.md) until sequenced in the roadmap and specified through an OpenSpec change.

### 1.1 Distributed direction is not current architecture

The future Surface, Node, Personal Realm, Workspace, Sandbox, and governing-authority boundaries described in [VISION.md](VISION.md) are not current runtime objects merely because the terminology is canonical. The first-party CLI and independently operable personal Node ship in the limited form described in §1.2. Android Nodes, cryptographic Node enrollment, Personal Realm mirroring, remote Workspace registries, cross-node execution placement or handoff, and foreign-authority mounts remain unshipped.

The current web, API, and worker processes form one installation and one PostgreSQL ownership boundary. A dedicated worker is an operational process role inside that installation, not an autonomous personal Node. A current Project is not a filesystem Workspace, Knowledge Space, Personal Realm, or security boundary. The hosted Knowledge Space ID is a portable logical identity, while its owner row and configured filesystem child remain installation-local bindings. Future terminology must not be projected onto present APIs, database rows, or deployment roles without a shipped capability spec.

### 1.2 Thin terminal and independently operable personal Node

`apps/cli` is a Surface, not the owner of local model execution or SQLite. In
local mode it launches or attaches to the private application in
`apps/node`, which composes `packages/personal-node`. The personal application also
has an independent `llame-node` executable. The Node owns configuration resolution, the bounded
OpenAI-compatible loop, one advancing executor, durable messages/events/receipts,
native/MCP tool execution, local lexical recall and managed live Markdown
Knowledge Spaces. No account, Postgres, inference download or daemon setup is
required. The default service is a temporary stdio child. Explicit `node serve`
is an independently persistent foreground service on a private Unix socket.

Remote mode retains the hosted HTTP/SSE/Bearer adapter. It does not access the
Node's SQLite, execute remote tools locally, or import the API implementation.
The saved remote remains the default until disabled or overridden with --local.
There is no automatic authority or provider fallback. Human remote sessions,
local runtime UUIDs and future cryptographic Node enrollment remain distinct.

The local protocol negotiates only implemented module versions. Local authority
comes from private process IPC or a 0600 socket beneath owned 0700 storage. Native
placement is fixed at Node boot and must be explicitly selected by the initiating
Surface. Per-operation approvals belong to that channel; disconnection denies
pending/future approvals. A persistent Node can finish inference after losing a
Surface; a temporary stdio Node cancels. Neither a crash nor event replay retries
an uncertain side effect. This is not hosted worker recovery or full feature parity.

SQLite schema version 2 preserves existing transcripts and Node/Chat/Run IDs,
adds message UUIDs and Chat-local locators, and maintains a rebuildable visible-text
trigram index. Knowledge IDs are bound into each Run and read using the existing
bounded hosted filesystem adapter, extracted to `packages/knowledge-filesystem`.
Logical-line scanning, redaction and result bounds remain shared runtime safety.
The CLI's authority/account-bound remote cursors are disposable private files,
not runtime-owned source state. Local read results may reach the configured
inference provider; filesystem privacy is not an egress policy or encryption.

See [`personal-node`](openspec/specs/personal-node/spec.md),
[`cli`](openspec/specs/cli/spec.md), the [protocol](docs/node/local-protocol.md),
the [operator guide](apps/cli/README.md), and the
[architecture decision](docs/research/cli/2026-09-05-personal-node-boundary.md).
Unless explicitly stated otherwise, subsequent sections describe the hosted
API/worker contract. Personal Realm replication and full execution/admin protocol
parity remain separate, unimplemented capabilities.

### 1.3 Common owner access and explicit admission

`packages/node-protocol` owns version-1 discovery and conversation/Knowledge
search/read contracts implemented by both runtimes. `packages/node-client` owns
reusable private-IPC and authenticated HTTP clients, separate from CLI rendering.
The hosted adapter exposes `POST /api/v1/node/requests` under existing session,
code-owned read-only gates, and RLS; the personal adapter uses private IPC version
2. An expected-principal header asserts the session identity, never selects one.
Capability declarations are rechecked at invocation. Native evidence and coverage
remain deployment-specific; the common envelope binds method, principal and source.

`POST /api/v1/runs` admits a hosted message with HTTP 202 and returns its durable
identities. Both this route and the existing web stream call the same acceptance
transaction and queue dispatcher. Losing admission is uncertain and never triggers
an automatic retry or alternate route. There is no request-thread agent loop.

Shared access does not enroll replicas, merge Home, proxy local tools to hosted
Runs, share databases, or synchronize credentials/files/events. Hosted descriptions
use the session-user identity, not a fabricated portable Node ID. See the
[node-access spec](openspec/specs/node-access/spec.md),
[contract](docs/node/shared-access.md), and [integration guide](docs/node/integration.md).

## 2. Conversation continuity

### 2.1 Compaction and provenance lineage

Context compaction stores an RLS-scoped summary with an `upto_seq` boundary and `parent_id` lineage. Source messages remain unchanged; model context becomes a typed historical checkpoint plus retained later messages. A switch to a smaller-window model may run one bounded transition compaction with the previous executable model; an unavailable capable source fails explicitly instead of truncating or crossing an ownership boundary. See [`apps/api/src/compaction`](apps/api/src/compaction), [`chats.ts`](apps/api/src/db/schema/chats.ts), and [`model-system-prompts`](openspec/specs/model-system-prompts/spec.md).

## 6. Identity and ownership

Authenticated identity comes from the server-validated opaque session. Client input and model arguments never select the acting user or tenant scope.

### 6.1 Organizational units

Nested organizational units, memberships, inherited roles, and external identities ship as identity foundations. See [`org-units`](openspec/specs/org-units/spec.md), [`org-memberships`](openspec/specs/org-memberships/spec.md), and [`external-identities`](openspec/specs/external-identities/spec.md).

## 7. Authorization and roles

Authorization fails closed. Tenant-owned tables use PostgreSQL RLS with `ENABLE` and `FORCE`; queries run with a transaction-local trusted user id.

### 7.1 External identities

External identity mappings bind a provider subject to one llame user. They are an identity primitive, not a channel permission grant.

### 7.2 Organizational access

Org-unit access and inheritance follow OpenSpec. They do not imply shared access to Projects, Chats, tools, or future knowledge.

Org-unit records also store and return opaque node-scoped `settings`; interpretation and inheritance are deferred to #46. See [`org-units`](openspec/specs/org-units/spec.md).

### 7.3 Roles

Current roles are `owner`, `admin`, `maintainer`, `member`, `viewer`, `guest`, and `service_account`. Capability authorization remains explicit.

### 7.5 Approvals

No hosted general approval workflow or per-tool allow/ask/deny policy ships; the standalone CLI separately requires per-action terminal approval for native writes/processes. Authentication, RLS, tool classification, and the static `tools.allowed` gate remain mandatory.

## 9. Chats and durable Runs

A Chat is the persistent conversation container. A Run is one queued agentic turn for a user message.

### 9.3 Run state

The current runtime uses only active states `queued` and `running_model` and terminal states `completed`, `failed`, `cancelled`, and `expired`. The database enum retains additional reserved states for migration compatibility; they are not current runtime behavior. Terminal state is immutable, and per-chat single-flight permits at most one non-terminal Run. A Run terminated by its own executor commits that terminal state and its turn's assistant message in **one transaction**: no reader may observe such a Run as terminal while its answer is not yet readable, because the terminal event is what makes clients refetch. A Run declared terminal by a recovery path instead (dead-letter expiry, while its executor was still streaming) is outside that guarantee — its executor can only salvage the partial answer after the fact. See [`durable-runs`](openspec/specs/durable-runs/spec.md).

### 9.4 Run events

Run progress is an append-only event stream. Clients subscribe, reconnect, and replay; they do not own execution state. Tool activity and outcomes persist for history reconstruction.

Persisted event families currently cover Run lifecycle (`run.created`, `run.started`, terminal `run.*`), model activity (`model.requested`, `model.delta`, `model.completed`), `reasoning.delta`, tool activity (`tool.requested`, `tool.started`, `tool.completed`), and `run.step_cap_reached`.

`run_events` is installation-local execution and reconnect state. It is not a cross-node protocol, Personal Realm replication journal, portable synchronization cursor, or grant of authority to resume execution elsewhere.

### 9.5 Execution boundary

Every chat message executes through pg-boss and `RunExecutionService`; there is no inline request-thread mode. A no-HTTP worker entrypoint ships, and worker profiles support co-located consumers. See [`durable-runs`](openspec/specs/durable-runs/spec.md), [`job-queue`](openspec/specs/job-queue/spec.md), and [docs/scaling.md](docs/scaling.md).

All current workers coordinate through the same installation's queue and database authority. The common owner-access slice in §1.3 is not a distributed execution protocol. No user-machine enrollment, direct or tunneled remote executor API, Workspace mount handoff, or cross-node execution-authority transfer ships.

### 9.6 Queue delivery and recovery

Infrastructure failures retry under bounded queue policy; exhausted jobs dead-letter. Native queue heartbeat recovers dead workers, terminal Run writes are first-writer-wins, and failed enqueue cannot leave a Chat permanently blocked. See [`job-queue`](openspec/specs/job-queue/spec.md) and [`durable-runs`](openspec/specs/durable-runs/spec.md).

### 9.7 Immutable model context

Every newly queued Run binds, in the message transaction, an owner-scoped immutable snapshot of its complete effective system prompt, advertised tool declarations, and source-neutral tool-availability manifest. The worker executes only that snapshot; later configuration or catalog changes affect later Runs. Availability is disclosed at a fresh conversation or post-compaction epoch only when degraded, then only on observable changes; unchanged state is not repeated. Owners can inspect the safe receipt through the Run API, while public shares, exports, and search exclude it. See [`model-context.ts`](apps/api/src/db/schema/model-context.ts), [`model-system-prompts`](openspec/specs/model-system-prompts/spec.md), and [`tool-calling`](openspec/specs/tool-calling/spec.md).

### 9.8 Context injection

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt is a **context item** on one rail: a single `<system-reminder producer="…" form="…">` envelope carrying a one-line provenance statement no operator prompt can remove, rendered as its own text block inside the triggering user message, in a fixed producer precedence order that preserves emission order within a producer. `producer` says who authored an item; `form` (`notice`, `snapshot`, `checkpoint`) says what kind of content it is. An unrecognized `form` is read as absent and an unrecognized `producer` renders nothing while still being recorded, so an older reader degrades rather than rejecting a newer writer's part. That tolerance removes the rejection, not the deploy ordering: producer-aware workers still ship before any API authors that producer, because a worker that does not know one silently omits its item for the life of that Run.

**Residency** decides whether a change re-renders the prompt or appends an item: an account of something that happened is rail-resident; a complete statement of state that changes less often than compaction is prefix-resident; one that changes more often is a frozen prefix baseline plus rail deltas, re-baked at compaction. A prefix change is silent to the model unless history was conditioned on the old value — assertional changes are announced, behavioral ones are not. Compaction is the single re-baseline boundary for the whole rail.

Reserved delimiters are neutralized on the user and tool rails so untrusted content cannot forge an item; assistant output deliberately is not, because a model does not treat its own prior turns as authoritative. Every Run records what it injected, as rendered, in owner-only `runs.context_items`; an item carrying content from outside its chat is not erasable through that content's own source. See [`context-injection`](openspec/specs/context-injection/spec.md), [`model-system-prompts`](openspec/specs/model-system-prompts/spec.md), [`tool-calling`](openspec/specs/tool-calling/spec.md), and [`chat-recency-digest`](openspec/specs/chat-recency-digest/spec.md).

## 13. Tools and integrations

The current Run loop interleaves model output with tool calls within an operator step cap. The code-owned tools are `search_conversations`, the optional `conversation_read`, and the optional personal Knowledge readers; operators may also configure instance-scoped Streamable HTTP MCP servers through the restart-applied top-level `mcpServers` map. A tool's input schema may be declared as either Zod (code-authored) or JSON Schema (external sources), with ajv-backed dialect-aware validation; malformed or unsupported declarations refuse only that tool before it enters the immutable Run snapshot.

Remote ids are stable `mcp__<server>__<tool>` names. Only the exact ids in `tools.allowed` may be advertised or executed, and an MCP allowlist entry is the operator's attestation that the operation is read-only—not automated semantic verification. Write, send, delete, execute, financial, and administrative MCP operations are prohibited. Two transports ship: remote Streamable HTTP, and local stdio servers llame runs as child processes. Supported protocol revisions are the session-capable `2025-03-26`, `2025-06-18`, and `2025-11-25` on both; sessionless MCP `2026-07-28` and deprecated HTTP+SSE do not ship. A stdio child receives only its declared `env` over the MCP SDK's base allowlist — llame's own environment is not passed through — and executes unsandboxed as the llame user.

Each API or worker process eagerly owns independent per-server clients and sessions. Disconnect and discovery failures withdraw only that server; turns never wait for remote discovery or reconnect, and workers execute only an exact declaration-hash match from the immutable Run snapshot. Configured endpoints are operator-approved outbound data boundaries. Redirects are disabled, while private endpoints are intentionally allowed for self-hosted services. See [`mcp-tools`](openspec/specs/mcp-tools/spec.md) and [docs/mcp-tools.md](docs/mcp-tools.md).

Queue retries restart a still-claimable Run's tool loop from its first step. That is safe only while every executable tool is read-only. The first write-capable tool must ship checkpoint-or-dedupe semantics that prevent a retry from applying the same effect twice; classification and approval alone do not solve replay.

### 13.5 Tool safety classification

Every tool declares one classification: `read_only`, `write_low_risk`, `write_high_risk`, `execute_code`, `external_send`, `financial_or_sensitive`, or `admin`. The current runtime executes only operator-allowlisted `read_only` tools. See [`tool-calling`](openspec/specs/tool-calling/spec.md).

### 13.6 Personal Knowledge reads

The code-owned `knowledge_search` and `knowledge_read` tools are optional,
operator-allowlisted `read_only` tools. Run acceptance resolves availability
for the authenticated owner inside the Run-binding RLS transaction, without
probing the API process filesystem. Workers resolve the binding from trusted Run
context, revalidate their local mount at execution, and fail closed when it is
unavailable. Tool declarations remain static; no tenant mutates the registry.

Completed calls, bounded outputs, failures, and unavailable reasons use the
generic durable tool-event and message-part path, so replay and the browser show
the same Knowledge-relative attribution. See
[`knowledge-tools`](openspec/specs/knowledge-tools/spec.md),
[`tool-calling`](openspec/specs/tool-calling/spec.md), and the
[operator runbook](docs/knowledge.md).

## 14. Provider and model configuration

Operators configure providers, models, defaults, secret references, and optional whole-file per-model system-prompt overrides in `llame.config.json`. Omitted overrides use the packaged project default; invalid configured files fail startup rather than silently falling back. The optional `knowledge.root` is one absolute operator-owned process-local path; configuration loading validates its shape without probing the filesystem. The API exposes executable model metadata and routes opaque model ids without exposing host prompt paths. User BYOK does not ship. See [`instance-config`](openspec/specs/instance-config/spec.md), [`available-models`](openspec/specs/available-models/spec.md), and [`model-system-prompts`](openspec/specs/model-system-prompts/spec.md).

## 15. Knowledge

Each authenticated owner may self-service multiple personal Knowledge Spaces
beneath the operator-configured `knowledge.root`. PostgreSQL stores the
tenant-scoped owner linkage, a stable opaque logical ID, a non-unique display
name, and timestamps; Knowledge Markdown content and search state remain in
files. Stable IDs—not names—drive authorization, local binding, tool selection,
and attribution. The hosted binding derives one direct child from each ID and
never accepts a caller-selected binding path or alternate source. Chat search is
not a Knowledge Space.

The authenticated `/api/v1/knowledge-spaces` REST collection supports named
creation plus cursor-paginated list, retrieve, and rename operations. It exposes
no delete operation or owner, root, child path, source, or content field.
Provisioning creates and validates the generated stable-ID child before the
authority row commits; a database failure may leave an unauthoritative child,
which recovery does not delete or claim. The root is not probed while loading
configuration. A provisioning process needs write access to create children,
while every `runs` consumer needs read access to all children it may execute.
Missing or unusable mounts fail closed, with no fallback to another owner or
host path.

When configured and allowlisted, `knowledge_search` and `knowledge_read` remain
callable even when the owner has no current space. Every invocation resolves the
owner's current access under RLS. Search accepts an optional stable ID and an
opaque live cursor; without an ID it traverses every current space in
deterministic keyset pages under one shared operation budget. Search is a
case-insensitive literal scan of admitted Markdown and returns bounded passages,
each with response-time space attribution, a Knowledge-relative path, zero-based
line `offset`/`limit`, and an excerpt. Matching lines in one file may produce
multiple passages; touching or overlapping context windows are merged before the
result limit is applied. Passage coordinates are directly usable as
`knowledge_read` arguments. A partial all-space search returns usable matches
with `complete: false` and bounded space-scoped warnings; a missing explicit ID,
zero inventory, total failure, invalid cursor, or global bound fails closed as
specified by `knowledge-tools`. The cursor is a live keyset continuation, not a
filesystem snapshot or revision receipt.

`knowledge_read` always requires an explicit stable ID and relative Markdown
path. It accepts optional zero-based line `offset` and `limit` coordinates, with
`limit` capped at 2,000. An omitted range requests the current note through EOF,
subject to the 2,000-line and structured-output bounds. Successful reads return
one-based line-numbered content, `lineCount`, and `nextOffset` when current lines
remain; a server cut reports `cutReason` and never clips a line. Search and read
use the current bounded Markdown filesystem, including modified or newly created
files without a Git commit. Admitted files remain capped at 1 MiB, and output
remains bounded. Newly executed results persist response-time space ID and name,
Knowledge-relative path, and live line coordinates; they expose no content hash,
expected hash, revision, host path, or alternate locator. Historical persisted
results may retain the earlier hash-bearing shape and remain immutable. Later
access changes affect the next check but do not rewrite historical results.

Git history, recoverable agent writes, accepted revisions, and synchronization
begin in #212 or later capabilities. No Knowledge index or embedding projection,
heading-aware search, table of contents, generated synopsis, stable citation or
Git revision contract, OKF/OpenWiki behavior, management UI, upload/import flow,
delete lifecycle, generic filesystem, Workspace, Sandbox, local Node, or
Personal Realm synchronization ships here.

The configured root and all child directories are trusted-writer-only. The
filesystem boundary rejects traversal and symlink components and opens final
files with `O_NOFOLLOW`. Path-based checks do not fully defend against a hostile
concurrent parent swap or hardlink race; future descriptor-relative containment
is required before supporting tenant-writable or synchronization-managed mounts,
which are unsupported by this MVP.

See [`knowledge-spaces`](openspec/specs/knowledge-spaces/spec.md),
[`knowledge-tools`](openspec/specs/knowledge-tools/spec.md), and the
[operator runbook](docs/knowledge.md).

## 19. Channels

No external messaging channel ships.

### 19.2 External identity mapping

The §7.1 mapping is reusable by future channels, but it does not authorize delivery or resource access.

## 20. Memory and search

Chats, Runs, messages, and events form the episodic record. Hybrid chat search is a rebuildable projection used by the web UI and `search_conversations`. It indexes canonical human-authored user and ordinary assistant text, not model-switch metadata, system prompts, tool receipts, generated summaries, or checkpoint envelopes. Canonical model excerpts are coverage-gated and carry message-sequence plus logical-line coordinates reusable by the owner-authorized `conversation_read`; exact reads derive current visible text from stored message parts and return numbered, bounded content. Semantic facts, vector retrieval, and automatic injection do not ship. See [`chat-search`](openspec/specs/chat-search/spec.md), [`search-projection`](openspec/specs/search-projection/spec.md), and the [operator runbook](docs/conversation-recall.md).

### 20.1 Authored personalization

Each user may author a `preferredName`, an `about`, and `responsePreferences`, gated by an `enabled` master switch (default on) and a `shareAccountIdentity` toggle (default off), rendered into that owner's system prompt per run through allowlisted per-user template paths. It is explicitly **authored, never inferred**: no field is derived from conversation content. Context precedence, highest first, is operator prompt and tool/safety constraints, then in-conversation instructions, then authored personalization, then any future inferred memory — only the top rung is structurally enforced, by the tool gate receiving no personalization input. See [`personalization`](openspec/specs/personalization/spec.md).

### 20.2 Owner-scoped memory settings

`shareRecentChats` is an owner-scoped setting on its own `memory` surface, **defaulting off**, read at bind time under a row lock so a withdrawal cannot lose a race with an accepted Run. It is deliberately **not** gated by `personalization.enabled`: that switch means "use my authored profile", and conversation-derived history is a separate consent decision with a different default. Enabling is retroactive over the owner's existing corpus; disabling is not retroactive; deleting a chat is not erasure from prompts already bound. All three are disclosed together in the API contract, because stating fewer is an incomplete consent contract. See [`memory`](openspec/specs/memory/spec.md).

### 20.3 Chat recency digest

An opted-in owner's chat resolves, on its first accepted Run, a capped digest of their other pinned and recent chats — title, last-activity date, message count, and a 200-code-point excerpt of the first user message, with no chat identifiers — and **freezes** it, so the digest contributes no per-turn variation: across turns whose other effective-context inputs are unchanged, the rendered prompt stays byte-identical and the snapshot is reused rather than re-minted. Personalization, the selected model's template, an operator prompt reload, and the tool-availability manifest are all snapshot inputs, so a change to any of them still mints a new snapshot — the freeze is a property of the digest, not a guarantee over the whole prompt. Changes reach the model as appended server-authored events on the reminder rail, never as a restated list; compaction is the only re-bake boundary. This is **awareness, not retrieval**: it exists so the model has reason to call `search_conversations`, and the content path stays RLS-scoped and auditable.

Two limits are recorded rather than glossed. The data-not-instructions framing is advisory, carried by the packaged prompt's prose and model compliance; only delimiter integrity is guaranteed. The compaction exclusion is likewise an instruction naming each delimiter — including the append rail's, which sits in the compactable prefix rather than the replayed prompt — and the structural alternative is foreclosed by putting the digest in the system prompt at all. See [`chat-recency-digest`](openspec/specs/chat-recency-digest/spec.md).

## 22. Service ownership

### 22.0 Web and API boundary

`apps/api` owns HTTP APIs, authentication, execution services, and all PostgreSQL access. It is authoritative for opaque session authentication accepted through an HttpOnly cookie or bearer token. Proxy trust is disabled unless the operator opts in through `http.trustProxy`.

`apps/web` is a thin Next.js client. It has no database, chat backend, or BFF-owned domain state; it consumes `apps/api` over HTTP and streaming contracts.

The code-first OpenAPI document generated by `apps/api` owns the endpoint contract. `apps/web` commits portable, tag-split Orval Fetch bindings under `apps/web/lib/api/generated`; every generated endpoint requires an injected Fetch implementation so browser, optional-auth, and server policies remain explicit. All non-streaming web requests use these generated bindings. Feature services and TanStack Query keys, hooks, mutations, pagination, cache policy, and domain error mapping remain handwritten. Chat send, reconnect, and run-event streaming remain explicit AI SDK/Fetch transports and are excluded from the generated bindings.

## 23. Technology constraints

### 23.1 Runtime stack

The product is TypeScript on Node.js: Next.js, NestJS, Drizzle, and pg-boss. A second backend language or parallel execution path requires an explicit architecture decision.

## 24. Storage and coordination

### 24.0.1 PostgreSQL coordination

PostgreSQL is the system of record for operational state and coordinates transactions, RLS, queues, locks, sessions, events, and lexical search. Search projections are rebuildable; identity and Run state are not.

No application-level Personal Realm synchronization or PostgreSQL physical/logical replication between autonomous user Nodes ships. The future portable resource contract in [VISION.md](VISION.md) does not weaken the current rule that `apps/api` and its PostgreSQL database own durable domain state.

Other storage must preserve the ownership and isolation boundaries in this file.

## 28. Model-input trust boundary

### 28.2 User and retrieved content

User messages, generated checkpoints, and tool or retrieval results are model input, not trusted authority. They cannot select tenant identity, top-level instructions, tool availability, or access scope. The bound Run snapshot is the sole system-prompt/tool-declaration authority. Stored system-role rows and persisted reasoning parts are excluded from replayed context. Tool observations are replayed in the conventional tool-call/tool-result representation, labelled untrusted, escape-proofed, and bounded per call and per turn. See [`context-builder.ts`](apps/api/src/chats/context-builder.ts), [`model-context.ts`](apps/api/src/db/schema/model-context.ts), and [`tool-calling`](openspec/specs/tool-calling/spec.md).
