## MODIFIED Requirements

### Requirement: Availability comparison retains only committed tool identities and states

A turn whose attempt commits the dispatch transaction that `context-injection`
defines SHALL retain, in that transaction, an owner/chat-scoped comparison
record consisting only of sorted exact tool ids and each id's `available` or
`unavailable` state, associated with that turn's message/Run. It SHALL contain
no schema, template, description, declaration/source hash, connection data, or
raw failure detail. This record SHALL NOT be used for tool admission, execution,
or reconstructing historical tool definitions.

Every attempt SHALL read the record of the most recent prior Run whose
`dispatched_at` is set within its disclosure epoch, whatever that Run's outcome; a retry of a dispatched Run SHALL instead read that Run's own record, and SHALL replace it in the reconciliation write that `context-injection` defines when its state differs. No observation SHALL remain distinct from an
observed empty record. A superseded attempt, and an attempt that fails before its dispatch transaction,
SHALL not establish or replace that baseline. The runtime catalog and safe current
reasons SHALL remain in memory; only actual committed reminder
text may retain its rendered explanation.

#### Scenario: Worker handoff preserves comparisons

- **WHEN** a retry of a Run that has not yet dispatched starts in another worker process
- **THEN** it compares its fresh runtime state with the same persisted prior id/state record
- **AND** it does not need the previous worker's catalog or an in-memory cross-Run cache

#### Scenario: Existing state is unobserved

- **WHEN** no historical observation exists
- **THEN** the attempt follows initial availability disclosure semantics
- **AND** it does not treat missing observation as an empty historical catalog

#### Scenario: Historical tool catalog storage is removed

- **WHEN** the coordinated migration removes combined context snapshots
- **THEN** only actual dispatched-turn id/state observations are retained for comparison
- **AND** schemas, descriptions, declaration hashes, and raw manifest payloads are not retained through renamed fields

#### Scenario: A failed Run's record becomes the baseline

- **WHEN** a Run commits its id/state record and then fails
- **THEN** the next turn reads that record as its comparison baseline
- **AND** it does not fall back to an earlier completed Run's record

### Requirement: Attempt availability is disclosed against the preceding dispatched turn

The worker SHALL derive availability disclosure from its current attempt's admitted runtime state and the minimal id/state record of the most recent prior Run whose `dispatched_at` is set, whatever that Run's outcome. It SHALL prepare canonical `tool-availability` context text for this attempt's model request and commit that text into message history in the attempt's dispatch transaction, before the request that carries it. The persisted text SHALL include the envelope, provenance, disclosure body, and closing delimiter and SHALL be the sole replay authority. The metadata SHALL retain ids, closed reason codes, and the Run/attempt id for machine behavior and provenance; it SHALL NOT retain remote-authored text, URLs, raw errors, or prompt contents. Client-authored availability parts MUST be rejected or discarded under the `context-injection` boundary contract.

For a configured MCP source that is not ready on the executing worker, previously committed exact ids that still match the current allowlist SHALL supplement availability-comparison input, even when the worker has never discovered that source. This SHALL be a separate non-admissible state-only input, never a `TurnToolCandidate` or an input to schema/classification/catalog admission. They SHALL carry only state and the current source's closed unavailable reason, never reconstructed declarations/classifications/executors, and SHALL not make `tools.<id>` true. Removed/disallowed/unconfigured ids are absent; a ready source's complete fresh discovery is authoritative about removal. No never-observed wildcard tool id SHALL be invented.

On the first turn of a model-facing availability disclosure epoch, the reminder SHALL identify only eligible tools that are currently unavailable under the exact heading `Unavailable tools:`; callable tools are already advertised through the provider's native tool declarations on every request and SHALL NOT be duplicated in an initial prose inventory. A fresh conversation SHALL start the first disclosure epoch, and every published checkpoint message SHALL start another under the rail epoch rule that `context-injection` states once. That epoch start stands even when the attempt it preceded later fails. On later turns within the epoch, the system SHALL compare each id's `absent`, `available`, or `unavailable` state between the current attempt's runtime state and the preceding dispatched turn's minimal id/state record in that epoch. Each changed id SHALL appear in exactly one group: absent to available as Added tools, available or unavailable to absent as Removed tools, absent to unavailable as Unavailable tools, available to unavailable as Became unavailable, and unavailable to available as Now available. Empty groups SHALL be omitted. `Added tools` SHALL contain only tools callable in the current Run. If availability is unchanged, no availability reminder SHALL be emitted, including while an outage persists.

When an eligible tool keeps the same id and remains available but its canonical declaration changes, the current attempt SHALL advertise its fresh in-memory declaration through the provider's native tool contract. Declaration-only drift SHALL NOT produce an availability reminder and SHALL NOT be represented as a synthetic Removed-plus-Added transition.

A turn SHALL establish the comparison baseline when its attempt's dispatch transaction commits, whatever the Run's outcome. Its committed reminder text remains model-visible until a context rewrite removes it. A superseded attempt, or an attempt that fails before its dispatch transaction, SHALL commit no availability reminder and SHALL not advance the baseline. A retried attempt of a Run whose `dispatched_at` is set SHALL reuse that Run's reminder and SHALL compare its own admitted runtime state with that Run's record, including after worker handoff; when they differ, it SHALL append the transition reminder as a reconciliation item under `context-injection` and replace the Run's record with its own in that write, so the reminders it sends agree with its native declarations and the next turn compares against what it disclosed. A retry of a Run that has not dispatched compares with the same preceding dispatched turn, unless a checkpoint published before the step started a new epoch, in which case every such retry uses the new epoch's initial semantics.

When there is no observed baseline, including migrated non-observation, the attempt SHALL use initial-baseline semantics. The dispatch transaction SHALL store only its sorted exact ids and available/unavailable states; empty observed state is distinct from no observation.

The first dispatched turn at or after a newly published checkpoint message SHALL use the same initial-baseline semantics as a fresh conversation and SHALL NOT compare against a pre-checkpoint record: it SHALL list currently unavailable eligible tools under `Unavailable tools:` and SHALL emit no reminder when all eligible tools are available. Because a checkpoint message publishes before the model step it was published for, that step's own turn is already the first turn of the new epoch. This new disclosure epoch SHALL NOT reset MCP clients, catalogs, reconnect backoff, attempt-local bindings, or other runtime or persisted state. A semantic checkpoint MAY retain prior tool outages, recoveries, or failures when they mattered to the conversation; those statements SHALL be treated as historical context rather than current availability. The current request's provider-native declarations and current runtime availability reminder, when present, SHALL establish current callability.

At authoring time, the reminder SHALL instruct the model not to simulate removed or unavailable tools or invent their results. Tool ids and reason prose SHALL be rendered only from validated ids and closed server-authored reason codes. Its persisted position relative to other context items SHALL follow the `context-injection` capability's author-time order, and later replay SHALL preserve that stored position without re-rendering or re-sorting it.

#### Scenario: Initial turn starts degraded

- **WHEN** the first turn has an eligible tool whose source is unavailable
- **THEN** a runtime availability reminder names the tool under `Unavailable tools:` in its shared author-time position before the user text

#### Scenario: Initial healthy turn uses native tool declarations

- **WHEN** every eligible tool is available on the chat's first turn
- **THEN** the provider's native tool declarations advertise the callable tools
- **AND** no runtime availability reminder duplicates them in prose

#### Scenario: Existing chat establishes its first observed baseline after migration

- **WHEN** the prior dispatched turn has no observed availability record and the current turn has healthy eligible tools
- **THEN** the provider's native tool declarations advertise those tools
- **AND** no Added-tools reminder is fabricated from the migration sentinel
- **AND** the dispatch transaction stores the minimal observed id/state record

#### Scenario: Availability changes between turns

- **WHEN** the current attempt differs observably from the previous dispatched turn's id/state record
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

- **WHEN** an attempt prepares an availability transition but fails before its dispatch transaction commits
- **THEN** a retry or later turn compares against the preceding dispatched turn
- **AND** the failed attempt's staged availability reminder does not publish into model history, while the attempt's own persisted output remains part of the record

#### Scenario: Failed prior Run establishes the baseline

- **WHEN** a Run commits an availability transition in its dispatch transaction and then fails
- **THEN** a later turn compares against that failed Run's record
- **AND** the transition's reminder stays in model history beside the Run's persisted output and is not announced again

#### Scenario: Unchanged outage emits no reminder

- **WHEN** an unavailable tool has not changed state since the prior turn
- **THEN** no runtime availability reminder is added solely because the outage persists

#### Scenario: Compaction starts a degraded disclosure epoch

- **WHEN** a checkpoint message publishes before a model step and that step's turn has an eligible unavailable tool
- **THEN** that turn uses fresh-conversation semantics and lists the tool under `Unavailable tools:`
- **AND** it does not emit a transition relative to the pre-checkpoint record
- **AND** a later unchanged turn does not repeat the reminder

#### Scenario: Compaction starts a healthy disclosure epoch

- **WHEN** a checkpoint message publishes before a model step and that step's turn has every eligible tool available
- **THEN** provider-native declarations advertise the callable tools
- **AND** no availability reminder or pre-checkpoint transition is emitted

#### Scenario: A failed attempt still starts the new epoch

- **WHEN** a checkpoint message publishes before a model step and that attempt later fails before its dispatch transaction
- **THEN** the next dispatched turn uses fresh-conversation disclosure semantics
- **AND** it does not compare against a pre-checkpoint record

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

#### Scenario: Retry reaches a fresh worker while an MCP source is offline

- **WHEN** the previous dispatched turn recorded an MCP id, the new worker has no remembered inventory, and that source remains configured and allowlisted but not ready
- **THEN** the id is an unavailable comparison record outside tool admission with its predicate false
- **AND** the notice reports unavailability rather than removal without reconstructing a tool definition

#### Scenario: Transient flap recovers between turns

- **WHEN** a tool disconnects and reconnects between two dispatched turn observations with the same availability
- **THEN** no operational event reminder is emitted solely for the recovered transient flap

#### Scenario: Availability renderer changes

- **WHEN** a later release changes availability wording or reason labels and replays an existing disclosure
- **THEN** the existing disclosure uses its persisted complete text unchanged
- **AND** only newly authored disclosures use the new wording

#### Scenario: Failed attempt observes a temporary outage

- **WHEN** the previous dispatched turn had grep available, an attempt sees it unavailable, commits that transition in its dispatch transaction, and fails, and its retry sees grep available again
- **THEN** the retry reuses the committed `Became unavailable` reminder, appends a reminder reporting grep under `Now available` after the reused items, and replaces the Run's record before its first model request
- **AND** the next turn compares against the replaced record and emits no reminder for grep

#### Scenario: A retry with unchanged availability adds nothing

- **WHEN** a dispatched Run is retried and the retry's admitted runtime state matches that Run's record
- **THEN** the retry sends the reused reminder, if any, and appends no availability reminder
- **AND** the Run's record is unchanged

#### Scenario: Baseline publication is atomic and fenced

- **WHEN** the active attempt commits its dispatch transaction
- **THEN** its exact reminder text and minimal id/state record commit atomically before its first model request
- **AND** superseded attempts cannot publish competing records

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The existing read-only loop may retry a claimable Run from its first step with freshly resolved
worker context only when that Run has no recorded native attempt or MCP dispatch. A retry SHALL
re-resolve its own prompt and its own attempt-local catalog rather than reuse the failed attempt's
preparation. A retry of a Run that has not dispatched SHALL compare availability against the same
preceding dispatched turn; a retry of a dispatched Run SHALL reuse that Run's turn-attached items
and compare availability against that Run's own record, as `Attempt availability is disclosed
against the preceding dispatched turn` defines. The failed
attempt's persisted output remains part of the committed record that later turns load. A Run that
has executed an alpha native `edit` or `write` SHALL NOT automatically replay that mutation after a
worker failure, timeout, or unknown settlement. A Run that has dispatched an MCP operation SHALL
likewise not automatically replay that operation. The host SHALL stop the affected Run with
`outcome_unknown` and require a new explicit user/model attempt. Client reconnect SHALL replay
recorded tool activity without executing the mutation or MCP operation again. A redelivered Run
carrying any recorded `native.attempt` SHALL fail as `outcome_unknown` without replaying its loop;
this recovery rule has no native-executor or `workerId` precondition. Before terminal settlement,
each open call with a matching durable `native.result` SHALL be settled from that result regardless
of tool source. An open `bash`, native mutation, or MCP call whose `native.attempt` is recorded
without a matching result SHALL settle as `outcome_unknown`; every other open call settles as the
termination settlement rules require.
A future durable effect-dedupe capability may replace this terminal behavior; it is outside this
change.

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

- **WHEN** a worker fails after a native mutation or MCP dispatch may have started but before its result is known
- **THEN** the effect is settled as `outcome_unknown` and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** a read-only Run's job is retried by the queue, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes from the first step again
- **AND** it may re-invoke read-only tools already invoked in the previous attempt

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** a job is retried for a Run that has already reached a terminal state
- **THEN** the Run is not reopened, no tool executes, and its terminal state stands

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run contains only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the existing read-only retry behavior remains available
- **AND** no native mutation is inferred from the read-only result

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

- **WHEN** an attempt admits a Knowledge tool recorded as unavailable in the availability record it compares against within the disclosure epoch
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

### Requirement: Tool observations survive into later turns as stored UI parts

The prospective cutover boundary in `context-injection` SHALL govern failed-attempt retention; existing conversation state SHALL not be retrospectively filtered or rebuilt. A failed, cancelled, expired, or superseded attempt keeps the partial output the settlement projects as the user saw it, together with the rail context its Run dispatched and the in-Run context items of exactly the attempts whose output is projected, under `context-injection`, and that record participates in later model context and compaction like any other committed turn. An individual failed tool call within a successfully committed attempt SHALL still retain its normal paired failure observation.

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
result. Credentials and unrelated payloads SHALL NOT replay, and the tool
projection SHALL NOT carry provider-native reasoning or metadata; persisted
reasoning parts and their provider metadata reach the provider only through
`reasoning-output`'s same-Chat replay, outside this projection and its budget.

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

Tool activity SHALL remain available to the model until a checkpoint absorbs
it, and no tool record SHALL cross that boundary. A checkpoint message SHALL
carry no tool part, SHALL select and re-bound no payload, and SHALL recompute no
budget; there SHALL be no semantic observation ledger, bounded replacement set,
or compacted tool record to read back. Absorbed tool activity survives only as
summary text, where the summary's `Errors and Corrections`, `Completed`, and
`Critical References` content is the carrier. Rows after the latest checkpoint
SHALL keep the ordinary bounded projection above unchanged, and replay of those
rows SHALL NOT consult the checkpoint.

Checkpoint text SHALL stay owner-scoped like the checkpoint row that carries it,
and no tool observation SHALL be reconstructed from summary prose, from an older
checkpoint's text, or from any inference about what an absorbed turn contained.

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
- **THEN** operational/UI replay reports its matching `cancelled` result, and that failed attempt's persisted output remains part of model history like any other committed turn
- **AND** it remains distinguishable from a tool-produced error

#### Scenario: A tool call made during reasoning is projected

- **WHEN** a tool was called while reasoning output was produced
- **THEN** the call/result observation follows the same replay contract
- **AND** the reasoning part is not carried by the tool projection; it replays
  under `reasoning-output` in its own occurrence position

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
- **AND** the tool projection carries no originating-provider reasoning or
  metadata; reasoning replay is governed by `reasoning-output`

#### Scenario: A model or provider switch keeps observations but not provider metadata

- **WHEN** a chat with tool activity continues on another model or provider
- **THEN** portable matched observations remain available through the target
  SDK conversion
- **AND** originating-provider metadata is excluded from the tool projection;
  replayed reasoning parts are passed back unchanged, `reasoning-output` omits
  before the request the ones the target wire cannot represent, and the target
  provider ignores or drops the rest

#### Scenario: The projection is labelled untrusted

- **WHEN** a tool result is replayed
- **THEN** its own result content identifies it as untrusted tool output
- **AND** instruction-like payload text carries no authority

#### Scenario: Replayed content cannot escape its boundary

- **WHEN** a tool result attempts to forge or close a reserved boundary
- **THEN** the replayed result is neutralized under the tool projection contract
- **AND** surrounding structure remains intact

#### Scenario: The projection is stable across turns

- **WHEN** the same unmodified ordinary stored tool part replays twice
- **THEN** the current projector produces the same application content
- **AND** no tool part is materialized at a checkpoint boundary

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

#### Scenario: Absorbed tool activity crosses a checkpoint only as summary text

- **WHEN** a checkpoint message absorbs a range of history that contains tool
  activity
- **THEN** that activity is available to later requests only as summary text
- **AND** the checkpoint message carries no tool record and replay of rows above
  it uses the ordinary bounded projection

#### Scenario: Recursive compaction consumes the prior checkpoint's stored text

- **WHEN** a later checkpoint supersedes a prior checkpoint
- **THEN** its summary input is the prior checkpoint's stored text plus the
  newly absorbed rows
- **AND** it writes no list of tool records and no record is carried forward

#### Scenario: A checkpoint without stored text cannot recover absorbed observations

- **WHEN** an active checkpoint message lacks valid non-empty stored text
- **THEN** request preparation fails closed
- **AND** no tool observation is invented from summary prose or from any ledger

#### Scenario: The live loop still observes its own tool results

- **WHEN** a tool executes during a Run
- **THEN** its result remains available within that same Run's tool loop

#### Scenario: An unprojected attempt's in-Run items stay out of later turns

- **WHEN** a retry's settlement projects only the retry's output after an earlier attempt recorded an in-Run context item
- **THEN** the earlier attempt's item is absent from the assistant message
- **AND** later turns replay only the projected attempt's tool observations and in-Run items

## RENAMED Requirements

- FROM: `### Requirement: Attempt availability is disclosed against the preceding successful turn`
- TO: `### Requirement: Attempt availability is disclosed against the preceding dispatched turn`
