## MODIFIED Requirements

### Requirement: Tool failure is an observation, not a crash

An uncertain native `edit` or `write` outcome SHALL abort the model execution
signal and settle the Run without further tool steps. Its tool observation SHALL
report `outcome_unknown` unless a known result is already durable. Ordinary
isolated failures retain the continuation behavior below.

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 120). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result.

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the serialized result, after secret redaction. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

A code-owned tool whose executor is inconsistent with its admitted in-memory id/schema/classification SHALL fail attempt preparation before a provider request. Fresh attempts SHALL resolve from the executing worker's trusted registry; no historical description or template hash SHALL be required. A dynamic source tool that loses its executor, disconnects, or drifts after attempt preparation SHALL instead retain its attempt-local model-facing declaration with an unavailable executor for that Run, so a requested call settles non-fatally without substituting a changed contract.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** an error result part is recorded, the model observes it, and the run proceeds to a final answer

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout
- **THEN** execution and any remote request/body are aborted and cleaned up
- **AND** a structured timeout error result is recorded and the run continues

#### Scenario: Invalid trusted timeout override fails admission

- **WHEN** a trusted tool registers a non-finite, non-positive, or above-global timeout override
- **THEN** registration or admission fails before the tool is advertised

#### Scenario: Dynamic executor disappears after enqueue

- **WHEN** a dynamic tool was bound into an attempt but its source disconnects before the model requests it
- **THEN** the call settles as structured `not_available`, no substitute executes, and the Run continues

#### Scenario: Code-owned declaration drift remains fail-closed

- **WHEN** a prepared code-owned declaration has an id/schema inconsistent with its trusted attempt-local executor
- **THEN** the Run fails before the provider request rather than executing a different contract

#### Scenario: Code-owned executor loss remains fail-closed

- **WHEN** a prepared code-owned tool has no compatible trusted executor at execution
- **THEN** the Run fails before the provider request rather than returning a dynamic unavailability observation

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a safe message, not a stack trace, raw remote error, or configuration value

#### Scenario: Truncated success result keeps its declared shape

- **WHEN** a successful result serializes above the cap
- **THEN** the recorded result keeps `status: "success"` and every top-level field the tool returned, with oversized values shrunk in place rather than replaced by a serialized fragment of the result

#### Scenario: Truncation cuts on a code-point boundary

- **WHEN** the cut point of an oversized string value falls between the halves of a surrogate pair
- **THEN** the truncated value is well-formed and contains no lone surrogate

#### Scenario: Truncation marker states omission and recovery

- **WHEN** a result is truncated
- **THEN** it carries a marker stating the number of omitted characters and that narrowing the call's arguments recovers the omitted content

#### Scenario: Cap outranks declared shape at the floor

- **WHEN** a successful result's top-level field names alone serialize above the cap
- **THEN** trailing fields are omitted so the recorded result still fits the cap
- **AND** the marker states how many fields of how many were omitted entirely

#### Scenario: Shortened list reports what survived

- **WHEN** truncation drops the tail of a list in the payload
- **THEN** the marker names that list and states how many elements were kept of how many it held
- **AND** when more lists were shortened than the marker names, the remainder is counted rather than named

#### Scenario: Error results are never truncated

- **WHEN** a structured error result is produced
- **THEN** it is recorded unchanged regardless of length

#### Scenario: Permission rejection is a non-fatal tool observation

- **WHEN** the execution policy rejects an otherwise valid available tool call
- **THEN** no tool executor or native effect attempt starts
- **AND** the model receives `permission_denied` and may continue within existing Run limits
- **AND** the system neither retries the rejected call automatically nor requests approval

### Requirement: Tool input schemas may be declared as JSON Schema

A tool SHALL be able to declare its input schema directly as JSON Schema, not only in code. Both forms SHALL receive the same argument validation, the same safety classification gate, the same operator allowlist gate, and the same tenant-scoped execution — neither form SHALL be privileged or exempted.

Argument validation SHALL be **effective**, not merely declared: a schema whose constraints are advertised to the provider but never checked against the returned arguments does not satisfy this requirement. Where the model SDK validates only when a validator is present, one SHALL be supplied, and a failure SHALL surface through the same non-fatal refusal path as any other invalid tool call rather than through a separate error shape.

A tool's schema SHALL be consumed without dialect rewriting. Nothing in this codebase SHALL require a source to declare, restate, or adjust its schema to a preferred JSON Schema dialect — external sources author their own schemas. A schema that declares a supported dialect and compiles successfully SHALL be accepted as shipped; lack of an available validator or compilation failure remains the explicit refusal case below.

Arguments SHALL be validated under the dialect the schema itself declares. Where no `$schema` is declared, draft-07 SHALL be assumed, matching both the model SDK's tool-schema typing and prevailing practice for tool schemas. Semantically equivalent URI forms for a supported dialect SHALL resolve to the same validator without rewriting the source document. A schema SHALL be refused only when it cannot be checked faithfully: no validator for its declared dialect is available, or the schema is malformed or invalid and cannot be compiled by that validator. The refusal SHALL name the affected tool and declared or assumed dialect, SHALL happen before the declaration enters the attempt-local model catalog, and SHALL NOT affect valid sibling tools. Validating a schema under a dialect other than its own SHALL NOT be done, because keywords such as `items` carry different meaning between dialects and the mismatch would silently enforce something the author did not write.

Standard JSON Schema formats supported by the validator integration, including `email`, `uri`, and `date-time`, SHALL be enforced when a schema declares them. Advertising a format while silently accepting values that violate it does not satisfy effective validation.

Comparing an attempt-local MCP source declaration against its current source SHALL NOT convert a schema that is already JSON Schema into another representation and back. Comparison SHALL be by **canonical equality**: two declarations are equal when their canonical forms — recursively key-sorted, with no other normalization — are identical. Key order and other insignificant serialization differences SHALL NOT count as drift; any difference in schema content SHALL. The same canonicalization SHALL be used when the in-memory declaration is admitted and when it is compared, so the two can never disagree.

#### Scenario: A schema is validated under its own declared dialect

- **WHEN** a source contributes a tool whose input schema declares a dialect for which a validator is available
- **THEN** the tool is accepted as shipped, and its arguments are validated under that dialect

#### Scenario: A schema without a declared dialect is accepted

- **WHEN** a source contributes a tool whose input schema declares no `$schema`
- **THEN** the tool is accepted and its arguments are validated under the assumed default

#### Scenario: An unsupported dialect refuses only the affected tool

- **WHEN** a source contributes a tool whose schema declares a dialect no available validator supports
- **THEN** that tool is refused, naming the tool and the dialect, and the refusal does not affect other tools from the same source

#### Scenario: A malformed schema refuses only the affected tool

- **WHEN** a source contributes one tool whose schema cannot compile and another tool with a valid schema
- **THEN** the malformed tool is refused before attempt advertisement, naming the tool and dialect, while the valid sibling remains available

#### Scenario: Equivalent supported dialect URIs select the same validator

- **WHEN** two otherwise-equivalent schemas declare canonical URI variants of the same supported dialect
- **THEN** both are validated under that dialect without rewriting either source schema

#### Scenario: Standard formats are enforced

- **WHEN** a JSON Schema constrains an argument using the supported `email`, `uri`, or `date-time` format
- **THEN** a conforming value is accepted and a non-conforming value is refused before execution

#### Scenario: Key order is not drift

- **WHEN** a bound declaration and its live tool differ only in the key order of their JSON Schema
- **THEN** they compare equal and the tool executes

#### Scenario: A changed schema is drift

- **WHEN** a live tool's schema differs from its bound declaration in any content — an added, removed, or altered constraint
- **THEN** they do not compare equal

#### Scenario: A JSON-Schema tool is advertised, validated, and executed

- **WHEN** an allowlisted tool classified `read_only` declares its input schema as JSON Schema, and the model calls it with valid arguments
- **THEN** it is advertised, its arguments are validated against that schema, and it executes through the same path as a code-authored tool

#### Scenario: Invalid arguments for a JSON-Schema tool are refused

- **WHEN** the model calls such a tool with arguments its schema rejects
- **THEN** the call does not execute, a structured non-fatal error result is recorded, and the run continues

#### Scenario: A schema advertised to the provider is also enforced locally

- **WHEN** a JSON-Schema tool is called with arguments that violate its schema but that the provider returned anyway
- **THEN** the violation is caught before the tool executes

#### Scenario: An unchanged JSON-Schema tool rebinds without spurious drift

- **WHEN** an attempt admits a JSON-Schema tool and later executes it, with nothing about that tool changed
- **THEN** the declaration matches and the tool executes

#### Scenario: Tool activity from a JSON-Schema tool reconstructs from history

- **WHEN** a chat containing a completed JSON-Schema tool call is reloaded
- **THEN** the persisted parts reconstruct the same call and result presentation as a code-authored tool

### Requirement: Tool observations survive into later turns as stored UI parts

These model-history rules apply only to observations from successfully committed attempts. Failed, cancelled, expired, or superseded attempts may retain operational/UI records, but their output and context SHALL not enter a retry, later model turn, recall projection, or compaction. An individual failed tool call within a successfully committed attempt SHALL still retain its normal paired failure observation.

A round's tool activity SHALL remain available to the model in later turns
within the bounded replay contract below. What a tool was asked and what it
returned or failed to return SHALL be representable on the next turn unless an
older complete observation must be omitted to enforce the hard budget.

Each replayed observation SHALL carry tool identity, input while its payload
fits, and structured outcome. Calls refused, cancelled, timed out, unavailable,
execution-failed, search-failed, or otherwise errored SHALL retain that outcome
rather than disappearing. Legacy output-error parts without structured outcome
SHALL map to generic `error` without parsing human prose; structured
cancellation metadata MAY recover `cancelled`.

Ordinary stored assistant parts SHALL replay through the existing conventional
AI SDK tool-call/tool-result projection until #599 establishes the canonical UI
message persistence contract. Every projected call SHALL be accompanied by its
matching result, including a well-formed result for a call with no genuine tool
result. Provider-native reasoning/metadata, credentials, and unrelated payloads
SHALL NOT replay.

The ordinary projection SHALL remain:

- portable through SDK tool-call and tool-result parts rather than
  provider-specific structures;
- labelled untrusted inside result content;
- neutralized so remote-authored result content cannot forge a reserved
  structural boundary;
- bounded in JavaScript UTF-16 code units over the exact serialized pair, at
  8,000 per pair and 32,000 per stored assistant turn;
- reduced by preserving pairing before budget, newer observations before older
  ones, and identity/outcome before payload; and
- stable for the same unmodified stored turn under the current explicit
  best-effort projector.

Payloads SHALL clear oldest-first only when clearing shrinks the envelope. If
irreducible pairs still exceed a limit, the oldest complete pairs SHALL be
dropped atomically until the projection fits, with one bounded omission count
and marker. An unmatched call or result SHALL never be emitted.

Visible assistant text and retained tool occurrences SHALL keep their current
chronology. Because ordinary stored messages do not prove parallel or step
boundaries, consecutive calls SHALL continue to project conservatively as
standalone sequential matched pairs. This behavior SHALL NOT be generalized or
rewritten by this change; its research/refactor is scoped by #599.

Compaction SHALL replace the semantic observation ledger with final
message-shaped replacement records. Ordinary and transition compaction SHALL:

1. correlate complete stored call/result observations by `toolCallId`;
2. combine them with tool records from the previous replacement history;
3. enforce the same complete-pair selection, per-pair limit, total 32,000-unit
   budget, newer-pair preference, payload clearing, outcome preservation, and
   bounded omission count; and
4. persist the selected final AI SDK UI `tool-*` parts in replacement history,
   with one complete pair per assistant replacement record and any omission
   marker in its own assistant text record.

The stored final replacement parts SHALL be the sole authority after compaction.
Model replay and cache-aligned compaction input SHALL order the user checkpoint
record first, the stored compacted tool records second, and the retained live
window last. Replay SHALL NOT regenerate tool parts from semantic fields,
re-clear payloads, recompute budgets, or reorder records. A later compaction MAY
materialize a new bounded replacement and omit older complete records, but it
SHALL consume the prior stored records rather than a ledger.

Replacement history SHALL remain RLS-scoped internal state and SHALL NOT enter
public DTOs, search indexes, or ordinary exports. No legacy ledger reader,
empty-ledger sentinel, or inference from summary prose SHALL exist.

The live tool loop SHALL continue to observe its own results within the turn
that produced them.

#### Scenario: A later turn can use an earlier tool result

- **WHEN** a tool returns a result and the user asks about it later
- **THEN** the later request carries its identity, input when retained, result,
  and outcome through the conventional SDK representation

#### Scenario: An unsuccessful call is projected as unsuccessful

- **WHEN** a prior call was refused, cancelled, errored, or timed out
- **THEN** later replay carries a matched result reporting that outcome
- **AND** the call is not silently omitted solely because it failed

#### Scenario: A cancelled call is projected as cancelled

- **WHEN** a prior call was settled by unsuccessful Run termination
- **THEN** operational/UI replay reports its matching `cancelled` result, while that failed attempt is excluded from model history
- **AND** it remains distinguishable from a tool-produced error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool was called while reasoning output was produced
- **THEN** the call/result observation follows the same replay contract
- **AND** the reasoning part remains display-only

#### Scenario: Every replayed call has a matching replayed result

- **WHEN** a later request replays stored tool activity
- **THEN** every retained call is immediately paired with its result
- **AND** unmatched calls/results are omitted atomically

#### Scenario: A call with no genuine result still carries a well-formed result

- **WHEN** a call was cancelled, refused, errored, or timed out before a genuine
  tool result existed
- **THEN** replay supplies a well-formed result carrying that outcome
- **AND** it does not narrate the absence as unrelated assistant prose

#### Scenario: Provider reasoning and metadata are never replayed

- **WHEN** stored tool activity includes reasoning or provider metadata
- **THEN** portable observations remain available across model/provider switches
- **AND** originating-provider reasoning and metadata do not replay

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with tool activity continues on another model or provider
- **THEN** portable matched observations remain available through the target
  SDK conversion
- **AND** originating-provider metadata is excluded

#### Scenario: The projection is labelled untrusted

- **WHEN** an ordinary or compacted tool result is replayed
- **THEN** its own result content identifies it as untrusted tool output
- **AND** instruction-like payload text carries no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result attempts to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** surrounding structure remains intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unmodified ordinary stored tool part replays twice
- **THEN** the current projector produces the same application content
- **AND** final compacted UI parts replay directly from replacement history

#### Scenario: Interleaved text and tools retain chronology

- **WHEN** an assistant turn contains visible text, tool calls, and later text
- **THEN** the current projector retains their occurrence order as standalone
  text and sequential matched pairs
- **AND** the implementation points to #599 instead of claiming proven step
  boundaries

#### Scenario: Visible text does not consume the observation budget

- **WHEN** visible assistant text surrounds capped tool observations
- **THEN** visible text retains its occurrence order outside the observation
  budget
- **AND** it does not cause an otherwise-retained pair to be dropped

#### Scenario: Hard limits preserve pairing and newest observations

- **WHEN** a serialized pair or turn exceeds its hard limit
- **THEN** payloads clear only when useful, then oldest complete pairs are
  omitted until the result fits
- **AND** exactly one bounded omission marker is retained and call/result counts
  remain equal

#### Scenario: Compaction carries cleared observations across lineage

- **WHEN** ordinary or transition compaction absorbs tool activity
- **THEN** it writes already selected, bounded, payload-cleared final UI tool
  parts into replacement history
- **AND** the next request replays those stored records after the checkpoint and
  before live history without a tool-observation renderer

#### Scenario: Recursive compaction consumes replacement history

- **WHEN** a later compaction supersedes a prior compaction
- **THEN** it consumes prior stored replacement records plus newly absorbed
  observations
- **AND** it writes a wholly new bounded replacement rather than reconstructing
  or extending a semantic ledger

#### Scenario: Existing compactions cannot recover already-absorbed observations

- **WHEN** an active compaction lacks valid replacement history
- **THEN** request preparation fails closed
- **AND** no old ledger or summary prose is used to invent tool observations

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result remains available within that same Run's tool loop

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The existing read-only loop may retry a claimable Run from its first step with freshly resolved worker context. It SHALL not reuse the failed attempt's model history, prompt, or catalog, and SHALL compare availability against the same previous committed turn. A Run
that has executed an alpha native `edit` or `write` SHALL NOT automatically
replay that mutation after a worker failure, timeout, or unknown settlement.
The host SHALL settle the mutation as `outcome_unknown` or fail the containing
native mutation attempt and require a new explicit user/model attempt. Client
reconnect SHALL replay recorded tool activity without executing the mutation
again. A future durable effect-dedupe capability may replace this terminal
behavior; it is outside this change.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation is not executed again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps and the run is expired by the deadman
- **THEN** the run terminates per existing semantics
- **AND** no partial tool-loop state is resumed on a new run

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live run after tool steps have completed
- **THEN** replay reconstructs those steps from durable events without executing a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation may have started but before its result is known
- **THEN** the mutation is recorded as `outcome_unknown` or the native attempt fails terminally
- **AND** a queue retry does not invoke that mutation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job is retried by the queue and the Run is still claimable
- **THEN** its tool loop executes from the first step again
- **AND** it may re-invoke read-only tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a Run that has already reached a terminal state
- **THEN** the Run is not reopened, no tool executes, and its terminal state stands

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run contains only read-only tools and its job retries
- **THEN** the existing read-only retry behavior remains available
- **AND** no native mutation is inferred from the read-only result

### Requirement: Conversation read uses the existing immutable read-only tool loop

The code-owned tool inventory SHALL include `conversation_read` in addition to `search_conversations` and `knowledge_search`. It SHALL declare `read_only`, require its own exact `tools.allowed` entry, and participate in the existing declaration admission, attempt-local runtime catalog, trusted executor binding, timeout, cooperative cancellation, settlement, persistence, replay, compaction, neutralization, and generic browser-rendering lifecycle. Owner authority SHALL come only from trusted Run context, never from model arguments or a message locator.

The conversation reader SHALL enforce the `conversation-reads` bounds of 2,000 logical lines and 15,000 JavaScript UTF-16 code units before generic result truncation. A read whose first selected source line cannot fit SHALL return `conversation_limit_exceeded`. Bounded pages SHALL preserve exact `nextOffset` and cut-reason metadata, and generic truncation SHALL NOT clip numbered source content.

Structured Chat/message sequence attribution, role/timestamp, numbered content, neighboring eligible sequences, continuation metadata, and the closed untrusted-history notice SHALL persist and render as authored through the ordinary tool UI. Replay SHALL NOT rehydrate newer message content, synthesize hashes/UUIDs/versions/part identities, remove line prefixes/notices, or normalize historical result shapes. Changing executable or Chat-local sequence semantics SHALL use a coordinated API/worker/data cutover; restart-applied description wording does not require a persisted declaration hash: quiesce new Run acceptance, drain Runs bound to the prior declaration and sequence interpretation, migrate durable sequence boundaries, deploy matching executors/declarations, then resume; rollback SHALL restore the matching prior binaries and data snapshot rather than mix locator interpretations.

A persisted conversation-read observation SHALL follow the destination Chat's existing retention and deletion lifecycle. Product behavior SHALL NOT delete an individual source message. Deleting or later losing access to the source Chat SHALL make a fresh read return `conversation_source_not_found` but SHALL NOT redact or rewrite text already recorded in another owner-visible Chat. Deleting the destination Chat SHALL remove its messages, Runs, and Run events through the existing cascade lifecycle.

Because the global-to-Chat-local sequence rewrite is a pre-merge alpha hard cutover, deployment SHALL preflight persisted assistant parts, compaction replacement history, and Run events before changing sequence values. If it finds an experimental canonical `search_conversations` result or `conversation_read` input/result authored under the prior global interpretation, the cutover SHALL abort before mutation. It SHALL NOT rewrite the historical observation, accept its global value as an alias, or guess between colliding locator namespaces. The unsupported experimental Chat or database must be removed/reset as a whole before retrying the cutover.

#### Scenario: Conversation reader is not allowlisted

- **WHEN** `conversation_read` is registered but absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly prepared execution attempt

#### Scenario: Allowlisted reader is bound immutably

- **WHEN** the exact reader ID is eligible for a newly prepared execution attempt
- **THEN** that attempt retains its exact declaration in memory and requires the matching code-owned executor
- **AND** no Chat/sequence argument supplies owner authority

#### Scenario: Bounded continuation survives persistence

- **WHEN** a reader success returns numbered content with `nextOffset` and a cut reason
- **THEN** live events, assistant-message settlement, browser reload, and full-payload replay preserve the exact result
- **AND** the persisted observation is not replaced by a generic truncation preview

#### Scenario: Historical read is not rehydrated

- **WHEN** message content, sequence navigation, or line-rendering code changes after a read result was persisted
- **THEN** reload and replay preserve the bounded historical observation as authored
- **AND** they do not reread the source or rewrite its coordinates/content

#### Scenario: Experimental global locator blocks the alpha cutover

- **WHEN** migration preflight finds a persisted canonical search/read observation in live message parts, compaction replacement history, or Run events authored with the unmerged global sequence interpretation
- **THEN** the cutover fails before rewriting any message or compaction sequence
- **AND** it neither mutates that observation nor installs a global-sequence alias path

#### Scenario: Source deletion does not rewrite another Chat's observation

- **WHEN** a persisted conversation-read result in one owner-visible Chat quotes a source Chat later deleted or unavailable
- **THEN** the historical result remains recorded while a fresh call returns `conversation_source_not_found`
- **AND** deleting the destination Chat removes that observation under the existing Chat/Run cascade lifecycle

#### Scenario: Generic tool UI remains the rendering floor

- **WHEN** a live or historical `conversation_read` result reaches the browser
- **THEN** the existing structured tool renderer displays its input, lifecycle state, result, or closed error
- **AND** no specialized source card, outline, activity timeline, or conversation-only renderer is required

#### Scenario: Conversation-read declaration cutover drains prior Runs

- **WHEN** deployment changes code-owned conversation declarations or the interpretation of message sequence fields
- **THEN** it stops accepting new Runs and drains Runs and queue payloads bound to the prior interpretation before migrating sequence boundaries
- **AND** acceptance resumes only after every API and worker exposes the matching declaration, executor, and Chat-local sequence semantics

## ADDED Requirements

### Requirement: Availability comparison retains only committed tool identities and states

A successfully committed turn SHALL retain an owner/chat-scoped comparison
record consisting only of sorted exact tool ids and each id's `available` or
`unavailable` state, associated with that turn's message/Run. It SHALL contain
no schema, template, description, declaration/source hash, connection data, or
raw failure detail. This record SHALL NOT be used for tool admission, execution,
or reconstructing historical tool definitions.

Every attempt SHALL read the preceding successfully committed turn's record
within its disclosure epoch. No observation SHALL remain distinct from an
observed empty record. Failed attempts and failed/cancelled/expired Runs SHALL
not establish or replace that baseline. The runtime catalog and safe current
reasons SHALL remain in memory; only actual successfully published reminder
text may retain its rendered explanation.

#### Scenario: Worker handoff preserves comparisons

- **WHEN** a retry starts in another worker process
- **THEN** it compares its fresh runtime state with the same persisted successful-turn id/state record
- **AND** it does not need the previous worker's catalog or an in-memory cross-Run cache

#### Scenario: Existing state is unobserved

- **WHEN** no successful historical observation exists
- **THEN** the attempt follows initial availability disclosure semantics
- **AND** it does not treat missing observation as an empty historical catalog

#### Scenario: Historical tool catalog storage is removed

- **WHEN** the coordinated migration removes combined context snapshots
- **THEN** only actual successful-turn id/state observations are retained for comparison
- **AND** schemas, descriptions, declaration hashes, and raw manifest payloads are not retained through renamed fields

### Requirement: Each execution attempt applies the fail-closed operator availability gate

Tool eligibility SHALL be governed by the operator allowlist in `llame.config.json` (`tools.allowed`). The default SHALL be an empty allowlist — an instance with no tools configured runs exactly as before this change (no tools advertised, none executable). The system SHALL first construct its source-owned inventory from registered code-owned tools and the safely admitted current or remembered-unavailable MCP inventory, then apply `tools.allowed` strictly as a boolean permission predicate over each candidate's canonical `tool.id`. Code-owned ids SHALL require exact entries. A canonical MCP id SHALL match either the same exact entry or a validated namespace rule `mcp__<configured-server>__*` whose terminal `*` is removed for literal ID-prefix comparison. Matching SHALL be case-sensitive. The validated trailing separator SHALL prevent one server prefix from matching a longer server id, and the reserved `mcp__` namespace SHALL prevent matching code-owned tools. Permission rules SHALL NOT create, copy, expand, or deduplicate candidates. A tool that matches no rule SHALL be neither advertised to the model nor executed if requested.

Exact and namespace MCP entries SHALL grant eligibility only to exact identities learned from safely admitted declarations for that server. When a live process loses the server transport, the last completely admitted identity set SHALL remain source inventory in an unavailable state; when complete discovery succeeds, its newly admitted identity set SHALL replace the prior set authoritatively. Neither permission form SHALL fabricate identities before first successful discovery or expose refused declarations. An eligible dynamic tool SHALL become advertisable or executable only while the source supplies a currently admitted declaration for that exact id under the operator's read-only attestation.

The executing worker's restart-applied allowlist SHALL filter exact ids and declarations into attempt-local memory when each execution attempt is prepared; wildcard patterns SHALL NOT enter provider requests, manifests, receipts, persistence, or execution binding. After a worker restart, changed exact or namespace rules SHALL apply to its next attempt, including a retry of an already scheduled Run. Declarations SHALL remain fixed within that attempt, while invocation permissions remain independently enforced. The executing process SHALL additionally apply its startup-loaded `tools.permissions` policy to each new invocation, including calls from older Runs. Hot policy reload remains outside this capability; operator changes require a restart. Remote tools remain restricted to operator-attested read-only operations. Write-capable MCP tools remain prohibited even when they claim idempotence; durable side-effect checkpointing and permission policy are separate follow-ups.

#### Scenario: Default is no tools

- **WHEN** the operator config does not set `tools.allowed`
- **THEN** runs never advertise or execute any tool

#### Scenario: Unlisted tool is not advertised

- **WHEN** a registered code-owned tool or discovered dynamic tool matches neither an exact entry nor an MCP namespace wildcard
- **THEN** it does not appear in the toolset offered to the model

#### Scenario: Unlisted tool is refused

- **WHEN** the model requests a tool that matches neither an exact entry nor an MCP namespace wildcard bound into the Run
- **THEN** the call is refused with a recorded, non-fatal tool error and the run continues

#### Scenario: Unknown tool id in the allowlist fails boot

- **WHEN** `tools.allowed` names an entry that is neither registered in code, a canonical exact dynamic id for a configured source, nor the canonical wildcard for a configured MCP namespace
- **THEN** startup fails naming the offending config path and id

#### Scenario: Eligible dynamic tool can remain unavailable

- **WHEN** a previously admitted MCP identity still matches an exact or namespace permission but its live process loses the server transport
- **THEN** unrelated Runs remain usable and the filtered identity is recorded as unavailable
- **AND** that tool is not advertised or executable for newly prepared attempts

#### Scenario: Permission does not create a fresh-offline identity

- **WHEN** a fresh process has no admitted or remembered MCP inventory and `tools.allowed` names an exact id or namespace from that server
- **THEN** the permission produces no runtime candidate or availability-state entry

#### Scenario: Complete discovery removes omitted identities

- **WHEN** successful complete discovery omits or refuses a previously admitted exact identity
- **THEN** the new source inventory no longer contains that identity
- **AND** the next execution attempt treats it as absent even when an exact or namespace permission would match it

#### Scenario: Namespace wildcard admits future exact ids

- **WHEN** a configured MCP server later supplies a safely admitted canonical tool id within its allowlisted namespace
- **THEN** the next execution attempt may bind and advertise that exact id without an instance-config change
- **AND** no wildcard pattern appears in the database or provider request

#### Scenario: Overlapping rules filter one inventory candidate once

- **WHEN** one exact MCP id is selected by both its exact entry and its server namespace wildcard
- **THEN** filtering retains the original inventory candidate once without creating another candidate

#### Scenario: Permission filtering does not hide source collisions

- **WHEN** distinct source candidates collide and both match one or more permission rules
- **THEN** both candidates reach the existing collision refusal unchanged rather than being deduplicated by permission matching

#### Scenario: Later allowlist removal applies to the next execution attempt

- **WHEN** an exact entry or namespace rule is removed from a worker's restart-applied configuration after a Run was scheduled
- **THEN** its next attempt, including a retry, omits tools no longer admitted
- **AND** the earlier attempt's catalog is never recovered from the database

#### Scenario: Queue retry may repeat only a remote read

- **WHEN** a queue retry restarts a Run before a prior MCP call result was durably settled
- **THEN** the operator-attested read-only call may execute again
- **AND** no write-capable MCP operation is eligible under this capability

#### Scenario: Permission reject does not hide a tool

- **WHEN** a tool remains admitted by `tools.allowed` and its execution permission group rejects every call
- **THEN** permission evaluation does not remove it from the attempt-local catalog or availability state
- **AND** attempted calls receive a non-fatal `permission_denied` observation

### Requirement: Code-owned Knowledge tools use the attempt-local read-only loop

The code-owned tool inventory SHALL include `knowledge_search` in addition to `search_conversations`; Knowledge file access is the `kb://` locator of the native file tools. `knowledge_search` SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, attempt-local tool catalog, trusted executor binding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool. The runtime catalog SHALL describe operation eligibility and declarations, not a Knowledge resource inventory, and SHALL not be persisted.

The operator allowlist controls only whether these fixed operations are eligible. It SHALL NOT choose an owner, configured root, child directory, path root, or execution location. A permitted Knowledge tool MAY accept a stable Knowledge Space selector as defined by its code-owned schema, but current authority for that selector MUST come from the trusted Run owner at execution time. Model input SHALL NOT supply or expand ownership or local filesystem authority.

For each newly prepared execution attempt, the executing worker's candidate resolver SHALL use its source declaration, safety classification, exact allowlist entry, and configured Knowledge root to determine Knowledge tool availability. It SHALL NOT query or snapshot the owner's Knowledge Space inventory. With a configured root, an owner with zero current resources SHALL still receive the callable tool declarations; invocation SHALL return `knowledge_space_not_configured`. Without a configured root, each otherwise-eligible Knowledge tool SHALL retain the closed `knowledge_space_unavailable` manifest state. The API acceptance path SHALL neither resolve the catalog nor probe the filesystem.

Worker execution SHALL receive the private filesystem resolver through trusted dependency injection or tool context and current owner identity through trusted Run context. It SHALL resolve current owner resources under RLS for every invocation and SHALL NOT serialize local binding data into declarations or accept it from model input.

Knowledge results SHALL retain the global execution envelope `status: "success" | "error"`; this change SHALL NOT add a generic `partial` status. A successful `knowledge_search` MAY additionally declare `complete: false` with bounded warnings. While its full payload is present, that structured result remains usable. Whenever a later model-replay projection clears that payload—including ordinary bounded next-turn projection and compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`; later replay SHALL preserve that outcome. Other successful tool results SHALL continue to project and compact as `success`. General partial-result semantics outside Knowledge are not defined by this requirement.

New Knowledge results SHALL persist and render the current passage/range attribution defined by `knowledge-tools` without requiring a content hash. Historical persisted Knowledge results MAY retain their earlier hash-bearing shape. Execution, persistence, replay, compaction, and browser rendering SHALL preserve either bounded observation as authored and SHALL NOT normalize historical results into the new shape or synthesize removed fields. Existing persisted calls without new optional range or cursor arguments SHALL remain valid observations.

Changing execution semantics or stored Knowledge locator interpretation SHALL remain a coordinated API/worker/data boundary. Description-template edits SHALL be restart-applied and do not create a historical declaration-hash requirement for a scheduled Run. Before replacing binaries for the passage-search declaration, the deployment SHALL quiesce new Run acceptance and drain every accepted Run bound to the prior declaration. It SHALL deploy matching API and worker binaries before resuming acceptance. Rollback SHALL quiesce and drain Runs bound to the newer declaration before restoring older API or worker binaries. No mixed-revision executor fallback or declaration normalization is introduced by this change.

The canonical closed Knowledge reason vocabulary and model-safe label mapping SHALL retain `knowledge_space_not_configured` and `knowledge_space_unavailable`. Because zero inventory no longer changes tool availability, `knowledge_space_not_configured` SHALL be emitted only as a tool-call result, not as a runtime availability state. Current missing process configuration SHALL use the safe `knowledge_space_unavailable` label. Recovery notices SHALL identify the restored tool without asserting a prior cause, because the previous committed record stores only id/state.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly prepared execution attempt

#### Scenario: Allowlisted Knowledge tool is admitted at runtime

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly prepared execution attempt with a configured Knowledge root
- **THEN** its exact declaration is included in that Run's in-memory tool catalog regardless of current owner inventory
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the executing worker has no configured Knowledge root
- **THEN** the attempt's runtime availability records `knowledge_space_unavailable`
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery does not infer a prior cause

- **WHEN** an attempt admits a Knowledge tool recorded as unavailable in the previous committed turn within the disclosure epoch
- **THEN** its `Now available` transition identifies that exact tool without inferring a stored failure reason
- **AND** no root, host path, or arbitrary reason text is rendered

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes with passage/range attribution and no content hash
- **THEN** its call and structured result persist and render after browser reload
- **AND** later model replay receives the complete matched pair, a payload-cleared matched pair with honest `success`, `incomplete`, or error outcome, or a bounded omission marker according to the existing pair and turn/ledger budgets

#### Scenario: Historical Knowledge observation is not rewritten

- **WHEN** a persisted Knowledge observation uses the earlier hash-bearing result shape
- **THEN** reload and replay preserve the bounded observation as authored
- **AND** no migration or projection invents new range fields or removes its historical fields

#### Scenario: Knowledge declaration cutover drains prior Runs

- **WHEN** a deployment changes the code-owned `knowledge_search` declaration
- **THEN** it stops accepting new Runs and drains Runs bound to the prior declaration before replacing API or worker binaries
- **AND** acceptance resumes only after every executing process exposes the matching declaration and executor

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists `knowledge_search`
- **THEN** the permission makes only that fixed operation eligible
- **AND** any supplied space selector still resolves solely through current trusted owner authority

#### Scenario: Zero inventory remains model-visible

- **WHEN** a Run owner has no current Knowledge Spaces but `knowledge_search` is otherwise eligible
- **THEN** the tool is advertised as callable
- **AND** invocation returns the closed `knowledge_space_not_configured` result

#### Scenario: Removed reader is not recreated from history

- **WHEN** historical tool activity mentions the removed `knowledge_read` id
- **THEN** a fresh attempt does not reconstruct or execute it from that history
- **AND** no shim, alias, or redirect to `read` is applied

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false` and its payload is later cleared by any model-replay projection
- **THEN** the payload-cleared observation and subsequent replay carry outcome `incomplete`
- **AND** the call is not upgraded to complete success

### Requirement: Attempt availability is disclosed against the preceding successful turn

The worker SHALL derive availability disclosure from its current attempt's admitted runtime state and the previous successful committed turn's minimal id/state record. It SHALL prepare canonical `tool-availability` context text for this attempt's model request and publish that text into message history only with successful turn completion. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the Run/attempt id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be rejected or discarded under the `context-injection` boundary contract.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every newly active compaction checkpoint SHALL start another. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current attempt's runtime state and the preceding successful turn's minimal id/state record in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current attempt SHALL advertise its fresh in-memory declaration through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

Only a successfully committed turn SHALL establish the comparison baseline. Its published reminder text remains model-visible until a context rewrite removes it. A failed, cancelled, expired, or superseded attempt SHALL publish no availability reminder to model history and SHALL not advance the baseline. Every retry compares with the same preceding committed turn, including after worker handoff.

When there is no successful observed baseline, including migrated non-observation, the attempt SHALL use initial-baseline semantics. Successful completion SHALL store only its sorted exact ids and available/unavailable states; empty observed state is distinct from no observation.

The first successfully committed turn after a newly active compaction checkpoint SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-compaction record: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, attempt-local bindings, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` in its shared author-time position before the user text

#### Scenario: Initial healthy turn uses native tool declarations

- **WHEN** every eligible tool is available on the chat's first turn
- **THEN** the provider's native tool declarations advertise the callable tools
- **AND** no runtime availability reminder duplicates them in prose

#### Scenario: Existing chat establishes its first observed baseline after migration

- **WHEN** the prior successful turn has no observed availability record and the current turn has healthy eligible tools
- **THEN** the provider's native tool declarations advertise those tools
- **AND** no Added-tools reminder is fabricated from the migration sentinel
- **AND** successful completion stores the minimal observed id/state record

#### Scenario: Availability changes between turns

- **WHEN** the current attempt differs observably from the previous successful turn's id/state record
- **THEN** the persisted reminder contains only the non-empty Added, Removed, Unavailable, Became unavailable, and Now available groups
- **AND** each changed id appears in exactly one group

#### Scenario: Newly eligible tool starts unavailable

- **WHEN** a tool was absent on the prior turn and is eligible but unavailable on the current turn
- **THEN** it appears under `Unavailable tools:` with a closed reason
- **AND** it does not appear under `Added tools:`

#### Scenario: Declaration-only drift uses the native contract

- **WHEN** an eligible tool remains available under the same id but its canonical declaration changes
- **THEN** the current attempt advertises its new in-memory declaration without persisting it
- **AND** no runtime availability reminder is emitted solely for that declaration change

#### Scenario: Failed prior attempt does not establish the baseline

- **WHEN** an attempt prepares an availability transition but fails
- **THEN** a retry or later turn compares against the preceding successful committed turn
- **AND** the failed attempt's reminder does not enter model history

#### Scenario: Unchanged outage emits no reminder

- **WHEN** an unavailable tool has not changed state since the prior turn
- **THEN** no runtime availability reminder is added solely because the outage persists

#### Scenario: Compaction starts a degraded disclosure epoch

- **WHEN** a newly active compaction checkpoint is followed by a turn with an eligible unavailable tool
- **THEN** that turn uses fresh-conversation semantics and lists the tool under `Unavailable tools:`
- **AND** it does not emit a transition relative to the pre-compaction manifest
- **AND** a later unchanged turn does not repeat the reminder

#### Scenario: Compaction starts a healthy disclosure epoch

- **WHEN** a newly active compaction checkpoint is followed by a turn where every eligible tool is available
- **THEN** provider-native declarations advertise the callable tools
- **AND** no availability reminder or pre-compaction transition is emitted

#### Scenario: Compaction preserves relevant tool-failure history

- **WHEN** a semantic checkpoint mentions a prior tool outage, recovery, or failure that mattered to the conversation
- **THEN** that history remains available to the model
- **AND** the current request's native declarations and current availability reminder, when present, govern current callability

#### Scenario: Unchanged healthy state emits nothing

- **WHEN** every eligible tool is available and availability has not changed since the prior turn
- **THEN** no runtime availability reminder is added

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes model and tool availability
- **THEN** both items are persisted in the order the `context-injection` capability specifies, ahead of the triggering user text within one user message

#### Scenario: Client attempts to forge availability metadata

- **WHEN** a client submits a message containing a tool-availability-shaped data part
- **THEN** the server rejects or discards it under the `context-injection` boundary contract
- **AND** only server-derived state can author the reminder

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two successful turn observations with the same availability
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

#### Scenario: Failed attempt observes a temporary outage

- **WHEN** the previous committed message had grep available, an attempt sees it unavailable and fails, and its retry sees it available again
- **THEN** the retry emits no restoration notice because it compares with the previous committed message
- **AND** the failed attempt changes neither the comparison record nor model history

#### Scenario: Baseline publication is atomic and fenced

- **WHEN** a winning attempt successfully commits its assistant turn
- **THEN** its exact reminder text and minimal id/state record commit atomically with that completion
- **AND** stale or failed attempts cannot publish competing records

## REMOVED Requirements

### Requirement: Tool availability is source-neutral and bound per Run

**Reason**: Catalogs resolve in memory per execution attempt. Only minimal
successful-turn id/state observations persist for subsequent comparisons.

**Migration**: Replace persisted versioned declaration-bearing manifests with
the minimal comparison record. Preserve successful observed empty states,
treat historical unobserved or failed Runs as having no baseline, and remove
declaration hashes and full manifests without reconstructing historical tools.

### Requirement: Fail-closed operator availability gate

**Reason**: Replaced by `Each execution attempt applies the fail-closed operator availability gate`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement with the worker-attempt cutover. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.

### Requirement: Code-owned Knowledge tools use the existing immutable read-only loop

**Reason**: Replaced by `Code-owned Knowledge tools use the attempt-local read-only loop`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement with the worker-attempt cutover. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.

### Requirement: Runtime tool availability is disclosed before the affected user turn

**Reason**: Replaced by `Attempt availability is disclosed against the preceding successful turn`; acceptance-time or failed-attempt publication semantics are retired.

**Migration**: Apply the replacement requirement with the worker-attempt cutover. Preserve unrelated scenarios and existing owner isolation; remove the obsolete binding/publication behavior.
