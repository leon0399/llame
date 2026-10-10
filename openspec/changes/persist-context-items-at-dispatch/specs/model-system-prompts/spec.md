## MODIFIED Requirements

### Requirement: Every execution attempt resolves its effective context in the worker

API acceptance SHALL persist the user message, selected public model/effort, and
Run identity without resolving or persisting an effective prompt/tool catalog.
Remove the old `modelContextSnapshotId` Run FK and required create input after
historical system receipts have been migrated; no placeholder snapshot SHALL be
created for acceptance. Source-context lookup SHALL follow the successful
Run's system-only receipt.
Each queue-authorized attempt SHALL resolve those fixed model choices through
its executing worker's configuration, reread the owner's safe variable
projection, and admit its worker-local current tool inventory. It SHALL render
the complete system prompt and admitted llame-owned descriptions together from
that one context. Existing digest and temporal lifecycles SHALL retain their
meaning. A missing selected model SHALL fail explicitly without fallback.

The system prompt and admitted declarations SHALL stay fixed in memory for
that attempt's target-model loop after the pre-step checkpoint publication and
final rendering. A trusted Workspace action admitted under `tool-calling` MAY
extend the in-memory declarations without replacing existing declarations; each
such addition SHALL take effect from the next model step, and Workspace exit,
switch, or detach SHALL leave its declaration in the attempt-local catalog with
an unavailable executor. The trusted executors and source declarations SHALL
stay bound together in that memory; current invocation permissions,
tenant/resource authority, and native recovery fences SHALL still apply. Source
loss or drift during an MCP attempt SHALL use the existing unavailable-call
behavior without substituting newer definitions.

Before target-model I/O, the worker SHALL persist its finalized system-only prompt receipt
under a still-current attempt identity. The pre-step compaction summary request
is not target-model I/O for that attempt: the attempt's receipt is bound after
the checkpoint publishes and records the prompt actually sent, and the summary
request's pre-re-bake render SHALL NOT become a receipt. The window variant of
that publication uses the previous completed Run's successful system receipt
and separately identified operational events. Full tool catalogs, templates, schemas,
descriptions, and source/declaration hashes SHALL NOT be persisted as execution
context. Minimal id/state comparison records SHALL follow
`tool-calling`. Any permitted retry SHALL resolve and render its system prompt,
catalog, and receipt again rather than using its predecessor's. A retry of a Run
whose `dispatched_at` is set SHALL reuse that Run's persisted rail items as
`context-injection` requires; any other retry SHALL derive its model context
afresh.

#### Scenario: Settings change while queued

- **WHEN** the owner changes personalization after queue acceptance but before worker execution
- **THEN** the attempt uses the current owner projection in both prompt surfaces
- **AND** its receipt records its actual rendered system prompt

#### Scenario: Catalog changes before retry

- **WHEN** an infrastructure retry runs with a changed worker catalog
- **THEN** it admits and renders the new attempt's catalog
- **AND** it never loads a catalog or rendered description from the database

#### Scenario: Tool definitions change during an attempt

- **WHEN** an MCP source disconnects or changes its declaration after attempt preparation
- **THEN** the existing in-memory declaration is not replaced
- **AND** a requested incompatible call settles through the unavailable-tool path

#### Scenario: Selected model is no longer executable

- **WHEN** the worker cannot resolve the queued Run's selected model or effort
- **THEN** preparation fails before target-model I/O
- **AND** another model is not substituted

#### Scenario: Render fails after scheduling

- **WHEN** current attempt inputs produce an invalid or empty effective prompt
- **THEN** that attempt fails final preparation with a safe error and no target-model request
- **AND** the scheduled message/Run remains recorded without a new comparison baseline

#### Scenario: Superseded attempt tries to publish context

- **WHEN** an earlier worker tries to write a receipt, model context, or completion after a newer attempt owns the Run
- **THEN** the stale write is refused under trusted attempt fencing
- **AND** it cannot replace the winning attempt or advance availability state

#### Scenario: Trusted Workspace addition extends the attempt catalog

- **WHEN** a trusted Workspace action adds an admitted declaration during a Run
- **THEN** that declaration joins the attempt-local model-facing catalog from the next model step without replacing an existing declaration
- **AND** a later Workspace exit, switch, or detach leaves the declaration present with an unavailable executor, as specified by `tool-calling`

#### Scenario: A retry of a dispatched Run renders afresh and reuses its rail items

- **WHEN** a Run's first attempt commits its dispatch transaction and fails, and a retry runs with changed personalization
- **THEN** the retry renders its own system prompt and appends its own receipt
- **AND** it sends the rail items the first attempt committed instead of authoring new ones

#### Scenario: A failed attempt's comparison record stands

- **WHEN** an attempt commits its dispatch transaction and its Run then fails
- **THEN** its minimal id/state record stays the comparison input that `tool-calling` defines for the next turn
- **AND** no tool catalog, schema, or description is persisted with it

### Requirement: A model switch replaces the top-level prompt and preserves portable history

For a turn whose selected model differs from the model of the most recent prior Run in the chat whose `dispatched_at` is set, whatever its outcome, the request SHALL use the target run's complete effective prompt as the sole top-level system prompt. It SHALL retain portable prior user/assistant history, omit prior top-level system prompts, include a trusted model-switch reminder immediately before the triggering user text, and use the target attempt's runtime tool declarations. Portable history SHALL use the canonical replay projection of visible user/assistant text, typed server-generated conversation checkpoints, and the replayed tool observations required by the `tool-calling` capability. It MUST NOT synthesize, rewrite, or re-bind an originating model's provider-native thinking/signature/cache metadata for the target model; reasoning parts and their provider metadata replay under the `reasoning-output` capability, which passes each part back unchanged, omits before the request any part the target wire cannot represent, and lets the target provider ignore or drop the rest. An unavailable target model SHALL fail transparently; the system MUST NOT execute another model as fallback.

Tool observations are no longer display-only. They are replayed in the conventional tool-call/tool-result representation, carried across a model or provider switch in the target provider's expected form, with every replayed call accompanied by its result. Reasoning parts are likewise no longer display-only for the Chat that stores them: `reasoning-output` replays each part and any provider metadata it carries, unchanged; the system neither coerces it nor selects which parts to keep by content, while the selected adapter still omits a part its wire cannot represent. What this requirement still forbids is llame synthesizing, rewriting, or re-binding an originating model's provider metadata for a different model.

#### Scenario: User sends the next turn with a different model

- **WHEN** the most recent prior dispatched Run selected model `A` and the user sends the next message with model `B`
- **THEN** model `B` receives model `B`'s effective top-level system prompt and tool declarations
- **AND** portable earlier conversation turns remain in history
- **AND** model `A`'s system prompt is not replayed

#### Scenario: Earlier turn contains reasoning and tool activity

- **WHEN** an earlier assistant turn persisted reasoning, provider-native metadata, or settled tool activity/results alongside visible answer text
- **AND** a later turn uses the same model or switches providers or models
- **AND** the settled tool activity is above the active checkpoint's absorbed-through boundary, or no active checkpoint exists
- **THEN** the later model receives the visible answer text through the canonical replay projection
- **AND** it receives the earlier tool observations in the target provider's expected representation, each call accompanied by its result
- **AND** the persisted reasoning parts and their provider metadata are passed back unchanged under `reasoning-output`, with no coercion, pruning, or re-binding for the later model

#### Scenario: Target context window cannot fit portable history

- **WHEN** a turn switches from model `A` to smaller-context model `B` and the
  complete request for `B` would exceed its configured context window or
  reserved output budget
- **AND** the previous completed Run used model `A`, and model `A` plus that
  Run's successful system-prompt receipt remain executable
- **THEN** the worker compacts with the previous completed Run's model `A` over
  history through the last assistant turn before invoking model `B`
- **AND** the triggering user message remains outside the summarized prefix
- **AND** model `B` receives its own prompt and tools, the resulting checkpoint
  message, the user and assistant rows above its absorbed-through sequence, and
  the switch reminder plus triggering user text

#### Scenario: No capable source model is available

- **WHEN** the target request does not fit and the previous completed Run's model
  or its successful system-prompt receipt is unavailable, or the source-model
  compaction fails
- **THEN** the run fails before the target provider call with
  `context_incompatible`
- **AND** history is not silently truncated and no fallback model is selected

#### Scenario: Over-window public-chat fork has no source execution context

- **WHEN** the owner of a public-chat fork sends a turn whose portable fork
  history does not fit the selected model
- **AND** no source-model system-prompt receipt owned by the fork owner can
  compact that history in one request
- **THEN** the run fails with `context_incompatible`
- **AND** the system does not access the source owner's snapshots, prompt
  receipts, credentials, or non-public metadata

#### Scenario: Target model is unavailable

- **WHEN** a model-switch turn selects a model that cannot execute
- **THEN** the run fails with the selected model's error
- **AND** no fallback model is invoked

#### Scenario: Same model continues

- **WHEN** the selected model is the same as that of the most recent prior dispatched Run
- **THEN** no model-switch reminder or model-switch UI boundary is created

#### Scenario: First turn in a chat

- **WHEN** a chat has no prior dispatched Run
- **THEN** the selected model receives its effective prompt normally
- **AND** no model-switch reminder is created

#### Scenario: The switch baseline and the compaction source differ

- **WHEN** a Run completed on model `A`, a later Run dispatched on model `C` and failed, and the next turn selects smaller-context model `B` whose request does not fit
- **THEN** the switch item names `C` as the prior model
- **AND** the window compaction uses model `A` with the completed Run's successful system-prompt receipt

#### Scenario: A failed dispatched Run keeps its model as the baseline

- **WHEN** the most recent prior Run used model `A`, set `dispatched_at`, and failed, and the next turn also selects `A`
- **THEN** no model-switch reminder or model-switch UI boundary is created
- **AND** model `A` receives its effective prompt normally

#### Scenario: A Run that never dispatched does not move the baseline

- **WHEN** a Run selected model `B` but failed before its dispatch transaction, and the next turn selects model `A`, which the dispatched Run before it used
- **THEN** no model-switch reminder is created

Failed-attempt visible output and tool observations SHALL remain part of the committed record and participate in later model context and compaction exactly as a successful turn's do, through the canonical replay projection, with their reasoning parts replayed under `reasoning-output`, except that a failed, cancelled, or expired Run supplies no measured context size, as the checkpoint contract below requires; the rail context its attempt dispatched is committed history too, as `context-injection` requires. Compaction SHALL run in the Run's own attempt before its first model step and SHALL follow the checkpoint contract below. The compaction source Run MAY differ from the switch item's baseline Run: when the prepared request does not fit that attempt's model, the summary SHALL use the previous completed Run's model, that Run's system-prompt receipt and effort, and no tool declarations; it SHALL NOT load, reconstruct, or persist a historical tool catalog.

### Requirement: Model switches use canonical persisted context text and metadata

The worker SHALL prepare a server-authored context part when the selected model differs from the model of the most recent prior Run in the chat whose `dispatched_at` is set, whatever its outcome. It SHALL commit that exact text on the triggering user message in the attempt's dispatch transaction, and the text SHALL stay there whatever the Run's outcome. Its
producer SHALL be `effective-context-change`, its form SHALL be `notice`, and
its `data.v` SHALL remain `1`.

The producer SHALL carry a closed cause vocabulary, of which `model` covers a
model change. A cause SHALL be a single value per item; simultaneous causes
owned by different producers SHALL remain separate items. It SHALL retain the
cause, prior public model id, target public model id, and target Run id as
non-rendering metadata for the owner-facing boundary and provenance. It SHALL
NOT duplicate dimensions owned by another producer, notably tool availability.
It SHALL also persist the complete canonical model-facing reminder beneath
`data.text`. Client-supplied context parts MUST be rejected or discarded.

The persisted text SHALL state that the active model changed before this user
message, name the prior model and the current model, each as its display name
followed by its public llame model id and, where the provider model id is
known, that provider model id, direct the assistant to follow current system
instructions and continue the existing conversation, and direct it not to
restart, reintroduce itself, or mention the model change unless the user asks.

Each model SHALL be rendered from a producer-derived descriptor carrying that
model's display name, public llame model id, and, when known, provider model
id; no other catalog value SHALL reach the body. The display name and the
provider model id SHALL be resolved from the configured model catalog when the
item is authored and SHALL remain rendering values rather than persisted
metadata. Where the catalog carries no name for a model, that model's public
llame model id SHALL stand in its name slot; where the provider model id is
unknown, that model's provider clause SHALL be omitted rather than rendered
empty. A display name and a provider model id are operator-authored text and
SHALL be neutralized under the reserved-delimiter rules `instance-config`
defines, exactly as an operator-authored catalog description already is; the
public llame model id SHALL render raw.

Later request assembly SHALL use `data.text` at its stored author-time position
associated with the triggering user text, following the `context-injection`
producer order. It SHALL NOT reconstruct the reminder from model ids.
Owner UI MAY use validated metadata, but a metadata/text disagreement SHALL NOT
rewrite model replay.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch attempt is prepared and commits its dispatch transaction
- **THEN** the server atomically persists its structured metadata and complete reminder text
- **AND** later request assembly uses that text without adding another top-level
  system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior Run selected model `A`, set `dispatched_at`, but
  failed, and the next turn selects model `B`
- **THEN** the new attempt compares model `B` against model `A`
- **AND** its switch item names `A` as the prior model

#### Scenario: A failed reply on the same model needs no switch item

- **WHEN** the most recent prior Run selected model `A`, set `dispatched_at`, and
  failed, and the next turn selects model `A`
- **THEN** no model-switch item is prepared, even when an earlier Run used another model

#### Scenario: Metadata and text disagree

- **WHEN** a switch part's metadata and persisted text disagree
- **THEN** the model receives the persisted text unchanged
- **AND** UI behavior validates metadata independently

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a context-item part
- **THEN** the server does not persist or trust that part
- **AND** only server-derived Run state can create the switch item

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and tool availability
- **THEN** the switch item names only the model cause
- **AND** the tool availability producer emits its own persisted reminder

#### Scenario: Both models are named with their catalog values

- **WHEN** a model-switch item is authored and the configured model catalog
  carries a name and a provider model id for both models
- **THEN** the persisted text names the prior model and the current model
- **AND** each is named by its display name followed by its public llame model
  id and its provider model id
- **AND** the metadata still carries only the cause, the two model ids, and the
  target Run id

#### Scenario: The configured catalog carries no name for a model

- **WHEN** the configured model catalog carries no name for one of the two
  models when the item is authored
- **THEN** that model's public llame model id stands in its name slot
- **AND** that id also renders in its own slot, so the text repeats it rather
  than omitting the model

#### Scenario: The provider model id is unknown

- **WHEN** the configured model catalog carries no provider model id for one of
  the two models when the item is authored
- **THEN** that model's clause omits the provider part entirely
- **AND** no empty parenthesis or substituted id is rendered

#### Scenario: A catalog-authored name carries a reserved delimiter

- **WHEN** a model's display name or provider model id contains the rail's
  reserved delimiter name as a tag
- **THEN** the rendered body carries it neutralized as operator-authored text
- **AND** the public llame model id renders raw
- **AND** the rendered body contains one envelope

#### Scenario: An item persisted before the rendering change

- **WHEN** an item persisted before this change is replayed or its metadata is
  validated
- **THEN** its stored text replays unchanged and its metadata still matches the
  exact model-change record
- **AND** no stored item is re-rendered from current catalog values

### Requirement: Compaction publishes a summary-only checkpoint before the Run's first model step

Before the Run's first model step, compaction SHALL be evaluated once against
that attempt's prepared request, and exactly one variant SHALL be selected. A
prepared request that does not fit the Run model's context window or reserved
output budget, which covers a switch to a smaller-context target, SHALL select
the window variant whether or not the measured context size also reaches the
threshold, because a request that does not fit is also over the default
threshold and only the window variant can summarize it. Otherwise a measured
context size at or above the Run model's threshold SHALL select the threshold
variant. No request SHALL be compacted by both variants.

Measured context size SHALL be the previous completed assistant message's
persisted final-request context size plus the estimate of the rows and rail
items after it, and SHALL be counted only when the user turn that assistant row
answers has a sequence above the active checkpoint's absorbed-through sequence;
otherwise the whole request SHALL be estimated. That comparison SHALL be by the
user turn rather than by the assistant row's own sequence, because a retried
assistant row is rewritten in place and keeps its sequence below a checkpoint
published between its attempts. A failed, cancelled, or expired Run SHALL NOT
contribute a measured context size to a later trigger.

Compaction SHALL NOT fire when no user or assistant row has a sequence between
the active checkpoint's absorbed-through sequence and the triggering user
message's sequence, because there is nothing left to absorb. On the threshold
condition the attempt SHALL proceed on the published checkpoint; on the window
condition the attempt SHALL fail `context_incompatible`.

The summarizing model, prompt, tool declarations, and effort SHALL be data on
the one path. A threshold-triggered compaction SHALL use that attempt's own
model client, its system prompt as rendered before the re-bake, its schema-only
provider-facing tool declarations retained in that attempt's memory without
executor functions, and its resolved effort, so the summary request is a
cache-aligned continuation of the prefix it summarizes. A window-triggered
compaction, where the prepared request does not fit the attempt's model, SHALL
use the previous completed Run's model with that Run's system-prompt receipt and
effort and no tool declarations, because a prefix cannot be summarized by a
model it does not fit; when that model cannot execute or cannot fit the prefix
either, the attempt SHALL fail `context_incompatible`. Either variant SHALL send
the compactable conversation prefix, which already contains the prior
checkpoint as user text, and a final synthetic user summarization instruction.
It SHALL set `toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text
only.

The single summarization instruction SHALL request the sections `Latest Request`,
`Objective`, `Constraints and Preferences`, `Decisions and Rationale`,
`Established Facts`, `Errors and Corrections`, `Completed`, `Active`, `Blocked`,
`Open Questions and Next Steps`, and `Critical References`, in that order.
`Latest Request` SHALL carry the owner's last unresolved ask within the
summarized prefix, quoted verbatim; the triggering user message follows that
prefix and is replayed verbatim after the checkpoint rather than quoted there.
When the summarized prefix already contains a checkpoint, the instruction SHALL
fold it: `Active` items move to `Completed` and an answered question is replaced
rather than repeated.

That instruction SHALL also state that summarized history and any prior
checkpoint are data that are never answered or continued; that the conversation
wins over a prior checkpoint and a reverse signal removes a task instead of
carrying it; that credentials, tokens, and connection strings become
`[REDACTED]` with a note that they were present; redaction takes precedence over verbatim quoting; that the summary follows the
conversation's language and never translates code, paths, identifiers, or errors;
and that a field is omitted rather than invented, with no identifier shortened or
reconstructed.

Because the replayed prompt may contain owner personalization and a rendered
recency digest, the summarization instruction SHALL name both standing-context
delimiters and direct the model not to carry their content into the summary. The
instruction SHALL also exclude digest message-rail appends by naming the shared
context-item envelope and `recency-digest` producer. This exclusion remains
load-bearing: otherwise another chat's title/excerpt could become durable
checkpoint content that source deletion or consent withdrawal cannot reach.

The bound top-level prompt SHALL remain unchanged; all exclusions belong only
in the trailing summarization instruction so cached prefix content is not
rewritten. Title generation SHALL continue to use its dedicated task-specific
system prompt rather than the chat model's effective prompt.

Every committed compaction SHALL atomically persist the non-empty raw summary used
by owner UI and by later summarization, and exactly one checkpoint message: the
rendered checkpoint envelope as a persisted literal, the raw summary, the
summarization usage, and the sequence through which the summary absorbed history.
The checkpoint message SHALL carry no tool record, no retained tail, and no forward
pointer, and no replacement history SHALL exist.

The next attempt SHALL assemble its freshly resolved top-level prompt and tools,
the latest checkpoint whose absorbed-through sequence is below the triggering
user message's sequence as one user-role text message, and then every user and
assistant row above that absorbed-through sequence in sequence order. Selection
is by that boundary rather than by the checkpoint row's own sequence, because a
pre-step checkpoint publishes above the user message it was published for. It
SHALL NOT re-wrap the raw summary, re-render checkpoint text, or reconstruct any
part from the summary. The raw summary remains separate; replay SHALL NOT parse
it out of the checkpoint text.

A later compaction SHALL consume the previous checkpoint as user text plus newly
absorbed messages and write a wholly new checkpoint message. No legacy checkpoint
renderer or compatibility fallback SHALL exist. A checkpoint without valid
non-empty stored checkpoint text SHALL fail closed rather than silently discard
or regenerate history.

The checkpoint message and the re-baked epoch state — the recency-digest
baseline, the temporal anchor, the skill-catalog baseline, the workspace
told-set, and the epoch markers naming the checkpoint message — SHALL commit in
one transaction before the model step the compaction preceded and before that
attempt resolves its own system prompt, its staged rail items, and its
system-prompt receipt, so the receipt records the prompt actually sent and every
re-baked value takes effect for the request the checkpoint precedes. A later
failure of that attempt SHALL leave them in place, because a checkpoint
describes committed history only, and a retry SHALL reuse the published
checkpoint instead of paying a second summary call. A retry of a Run whose
`dispatched_at` is set SHALL NOT publish a pre-step checkpoint; when its request
no longer fits, that attempt SHALL fail `context_incompatible`. Publication SHALL be
idempotent across a worker-attempt cutover, and stale work SHALL NOT alter a
prepared live attempt's context.

Compaction SHALL estimate the request actually sent and SHALL NOT load,
reconstruct, or persist a historical tool catalog. Tool execution remains
disabled. If the request still does not fit after that one compaction, the
attempt SHALL fail `context_incompatible`. Post-cutover failed-attempt output
SHALL remain part of the record and enter compaction input like any other
committed turn, together with the rail items its attempt dispatched.
Existing history and checkpoints SHALL retain the preservation boundary defined
by `context-injection`.

The persisted checkpoint envelope SHALL state that the session state may already
reflect work described in it and SHALL direct the assistant not to repeat that
work.

#### Scenario: A pre-step trigger compacts before the first model request

- **WHEN** the prepared request of a Run reaches its model's threshold or does
  not fit that model's window
- **THEN** summarization runs inside that attempt before its first model step,
  using the model, prompt, tool declarations, and effort the trigger selects,
  its compactable history, and the single trailing instruction
- **AND** the checkpoint message and its raw summary commit atomically before
  that model step

#### Scenario: A request over both the window and the threshold takes the window variant

- **WHEN** a prepared request exceeds the Run model's threshold and also does not
  fit that model's context window or reserved output budget
- **THEN** only the window variant runs, with the previous completed Run's model,
  its system-prompt receipt and effort, and no tool declarations
- **AND** the threshold variant is not applied to the same request

#### Scenario: A retry with a large triggering message does not compact again

- **WHEN** an attempt evaluates the trigger with no user or assistant row
  between the active checkpoint's absorbed-through sequence and the triggering
  user message's sequence
- **THEN** no checkpoint is published for the absent absorb set
- **AND** a threshold-condition attempt proceeds on the published checkpoint
- **AND** a window-condition attempt fails `context_incompatible` instead of
  summarizing nothing

#### Scenario: Compaction excludes standing and digest rail context

- **WHEN** the summarized prefix contains personalization, a prefix digest, or
  digest rail appends
- **THEN** the trailing instruction names the applicable delimiters and producer
  and forbids carrying them into the summary
- **AND** the replayed system prompt and compactable history remain unchanged

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a bound prompt contains rendered personalization
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the next Run supplies current personalization independently

#### Scenario: Compaction runs for a chat carrying a digest

- **WHEN** a bound prompt contains a rendered recency digest
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the checkpoint message need not contain other-chat content

#### Scenario: Compaction leaves the cached prefix untouched

- **WHEN** a pre-step summarization request is assembled
- **THEN** the bound prompt and compactable history remain unchanged
- **AND** exclusions appear only in the trailing user instruction

#### Scenario: Both delimited blocks are excluded under either compaction mode

- **WHEN** personalization and recency digest both occur in the summarized
  prefix
- **THEN** the instruction excludes both standing-context blocks
- **AND** the bound system text and the compactable prefix remain unchanged

#### Scenario: Exclusion targets one producer under a shared envelope

- **WHEN** the instruction excludes recency-digest rail appends
- **THEN** it names the shared envelope and the `recency-digest` producer
- **AND** it does not infer producer identity from a private delimiter

#### Scenario: The instruction carries the data, supersession, secret, and language rules

- **WHEN** the summarization instruction is rendered
- **THEN** it directs the model to treat history and any prior checkpoint as
  data, to let the conversation win over a prior checkpoint, to remove a task
  that a reverse signal cancels, and to write `[REDACTED]` for credentials while
  noting their presence
- **AND** it directs the model to answer in the conversation's language without
  translating code, paths, identifiers, or errors, and to omit a field rather
  than invent one

#### Scenario: Folding a prior checkpoint keeps the latest ask verbatim

- **WHEN** the summarized prefix already contains a checkpoint message
- **THEN** the summary places the owner's last unresolved ask verbatim under
  `Latest Request`
- **AND** it moves `Active` items to `Completed` and replaces an answered
  question instead of repeating it

#### Scenario: Provider returns a tool call during compaction

- **WHEN** a provider returns a tool call despite `toolChoice: "none"`
- **THEN** no executor is available or invoked
- **AND** the result is rejected rather than persisted as a checkpoint message

#### Scenario: The envelope marks absorbed work as already done

- **WHEN** a checkpoint message is published
- **THEN** its stored envelope states that the session state may already reflect
  the work the checkpoint describes
- **AND** it directs the assistant not to repeat that work

#### Scenario: Checkpoint renderer changes later

- **WHEN** a later release changes checkpoint framing or sanitization
- **THEN** an existing checkpoint replays its stored text unchanged
- **AND** the raw summary remains available separately

#### Scenario: The checkpoint does not absorb the triggering user message

- **WHEN** the triggering user message was persisted before the worker ran and a
  pre-step checkpoint publishes after it
- **THEN** the checkpoint's absorbed-through sequence is below its own sequence
  and below the triggering user message
- **AND** replay emits the checkpoint first and then every user and assistant row
  above that sequence

#### Scenario: Next turn follows a compaction

- **WHEN** a Run is assembled after a published checkpoint
- **THEN** current top-level prompt and tools are followed by the checkpoint as
  one user-role text message and then every later user and assistant row in
  sequence order
- **AND** no checkpoint text is regenerated from the raw summary and no row is
  reordered

#### Scenario: Model changes after compaction

- **WHEN** a model switch follows a stored checkpoint
- **THEN** the target receives its current top-level prompt and tools
- **AND** the checkpoint replays as portable historical data before the new
  persisted switch reminder

#### Scenario: A checkpoint without stored text fails preparation closed

- **WHEN** request assembly encounters a checkpoint message without valid
  non-empty stored checkpoint text
- **THEN** preparation fails closed
- **AND** it does not render a checkpoint from the raw summary

#### Scenario: A window trigger precedes a smaller-context target

- **WHEN** a model switch requires compaction because the prepared request does
  not fit the target's window
- **THEN** the previous completed Run's model uses its last successful
  system-prompt receipt and its own effort to summarize only eligible committed
  history without tool declarations
- **AND** the target request uses the resulting checkpoint message before the
  triggering user message

#### Scenario: A target attempt fails after a pre-step checkpoint

- **WHEN** a checkpoint published before a model step and that attempt later
  fails
- **THEN** the checkpoint and the re-baked epoch state remain active
- **AND** a retry reuses them instead of paying a second summary call

#### Scenario: A retry of a dispatched Run does not compact

- **WHEN** a retry of a Run whose `dispatched_at` is set prepares a request that no longer
  fits its model or reaches its threshold
- **THEN** no checkpoint is published for that attempt
- **AND** a request that does not fit fails `context_incompatible`, while one over only
  the threshold proceeds uncompacted

#### Scenario: A failed Run's rail items enter compaction input

- **WHEN** a checkpoint absorbs a failed Run whose user and assistant messages carry the
  rail items it dispatched
- **THEN** the compactable prefix includes those items as stored text, like a completed
  Run's
- **AND** the trailing instruction still excludes `recency-digest` appends

#### Scenario: The receipt records the prompt sent after the re-bake

- **WHEN** a pre-step checkpoint and its re-baked epoch state commit inside an
  attempt
- **THEN** that attempt resolves its own system prompt, its staged rail items,
  and its system-prompt receipt only after that commit
- **AND** the receipt records the prompt actually sent, and every re-baked value
  takes effect for the request the checkpoint precedes

#### Scenario: A duplicate checkpoint publication is a no-op

- **WHEN** a worker-attempt cutover or a superseded attempt publishes a
  checkpoint
- **THEN** a second publication for the same chat and absorbed-through sequence is
  a no-op and the attempt reads the surviving checkpoint
- **AND** stale work does not alter a prepared live attempt's context

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix
  around a retained historical boundary
- **THEN** it does not reuse this compaction
- **AND** it requires a separately specified summary contract

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to inspect immutable system-prompt-only receipts for
every execution attempt that completed prompt preparation. Each receipt SHALL
contain the Run/attempt identity, public model id and effort, prompt source
label, exact rendered system prompt including projected owner values, prompt
hash, and resolution timestamp. A new attempt SHALL append its own receipt and
SHALL NOT overwrite or execute from a previous attempt's receipt. Failed-attempt
receipts remain owner inspection data and SHALL NOT become model history.
Receipt identity SHALL be unique per owner/Run/attempt, with an owner-matching
Run relationship and zero or more receipts per Run. Identical text/hash SHALL
not reuse another attempt's receipt. Completion SHALL identify its successful
attempt. A receipt proves preparation, not dispatch; correlated request events
SHALL distinguish those states.

The receipt API SHALL distinguish an owned queued/preparing Run with no receipt
from an unknown or non-owned Run: the former SHALL report not-yet-resolved
status, the latter SHALL return not found. An attempt that fails before prompt
preparation SHALL not fabricate a receipt. The existing owner-only context-receipt endpoint SHALL return resolution state,
active/completed attempt identifiers, and an ordered list of system-only
receipts keyed by attempt id. An owned Run with no prepared receipt SHALL have
an empty list and its actual unresolved/not-produced state. The UI SHALL expose
each prepared attempt and fetch this response on demand.

Receipts SHALL contain no tool catalog, schemas, descriptions, availability
manifest, declaration hashes, or combined prompt/tool content hash. Except for the
owner-only host-path exceptions below, private prompt-file paths, MCP connection
information, raw source errors, provider credentials, and executor context SHALL
remain undisclosed. The canonical Workspace root narrated by the `workspace`
producer and Workspace skill source/package/file paths SHALL be permitted in the
owner-only recorded model-visible context; operator skill source/package/file
paths intentionally published under `agent-skills` SHALL likewise be permitted
in recorded model-visible skill contributions. These host-path exceptions SHALL
NOT expose prompt-file paths, Knowledge backing paths, credentials, or other
private configuration. Non-owners SHALL receive a not-found response.
Historical system prompt receipts SHALL survive catalog-column removal;
historical tool receipt fields SHALL be removed rather than rebuilt from current
configuration.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run

#### Scenario: Owner inspects runtime tool availability

- **WHEN** the chat owner opens a receipt for a Run with unavailable eligible tools
- **THEN** the receipt shows only the attempt's recorded system prompt and receipt metadata, without a tool catalog or availability manifest
- **AND** it exposes no endpoint, header, session, or raw remote error data

#### Scenario: Owner inspects migrated historical availability

- **WHEN** the owner opens a migrated historical system-only receipt whose former snapshot had no observed availability
- **THEN** the migrated receipt retains its original system prompt without tool availability fields
- **AND** migration does not fabricate an observed comparison baseline from historical non-observation

#### Scenario: Owner inspects a model-specific prompt

- **WHEN** the chat owner opens the effective-context receipt for a run using a per-model override
- **THEN** the exact recorded system prompt is displayed for its identified attempt
- **AND** the source is labeled `Model-specific override`
- **AND** no private configuration host path is present; intentionally published operator skill paths remain visible

#### Scenario: Owner inspects a default prompt

- **WHEN** the chat owner opens the receipt for a run using the project prompt
- **THEN** the complete project prompt contents are displayed
- **AND** the source is labeled `Project default`

#### Scenario: Another user requests the receipt

- **WHEN** an authenticated user requests a run context receipt they do not own
- **THEN** the API responds as though the receipt does not exist
- **AND** no model, prompt, tool, availability, endpoint, or path metadata is disclosed

#### Scenario: Skill activation does not mutate the enqueue receipt

- **WHEN** a skill activation publishes its package directory and resolved file path after the Run is claimed
- **THEN** the immutable enqueue receipt stays unchanged and the triggering user message carries the final activation text
- **AND** the skill path exception does not expose Knowledge backing paths or private prompt configuration

#### Scenario: Queued receipt is pending

- **WHEN** an owner inspects a Run before any attempt has prepared its system prompt
- **THEN** the response identifies it as not yet resolved with no fabricated prompt or tool data
- **AND** a non-owner requesting the same Run receives not found

#### Scenario: Retry renders different personalization

- **WHEN** a retry renders a different system prompt from an earlier failed attempt
- **THEN** both prepared attempts have separate immutable system-only receipts
- **AND** committed model history carries the turn-attached items the first dispatched attempt committed, which the retry reuses

#### Scenario: A failed attempt's dispatched items stay in history

- **WHEN** an attempt prepares its receipt, commits its dispatch transaction, and then fails
- **THEN** its receipt stays owner inspection data outside model history
- **AND** its dispatched items stay on the Run's messages as model history

#### Scenario: Owner inspects Workspace paths in effective context

- **WHEN** the chat owner opens an effective-context receipt for a Run whose `workspace` producer narrated a canonical Workspace root and whose Workspace skill activation published source, package, or file paths
- **THEN** the owner can see the canonical Workspace root and Workspace skill source/package/file paths in the recorded model-visible context
- **AND** prompt-file paths, Knowledge backing paths, credentials, and other private configuration remain undisclosed

### Requirement: Context receipts and control metadata remain private projections

Persisted context-item parts of every producer, generated item prose, receipt references, and system-prompt receipts and private availability comparison records MUST NOT appear in public-share responses, ordinary transcript exports, or chat-search projections. System prompt receipt contents are visible only to the owner; minimal availability records remain private comparison state and are not a catalog inspection API.

#### Scenario: Public chat is viewed

- **WHEN** an anonymous or non-owner viewer loads a publicly shared chat containing model switches or runtime tool-availability changes
- **THEN** ordinary shared user/assistant content remains visible
- **AND** context-item parts of every producer, owner receipt actions, prompt contents, and private availability records are absent

#### Scenario: Owner exports the transcript

- **WHEN** the owner creates an ordinary Markdown transcript export
- **THEN** the export contains presentation-safe conversation content
- **AND** it omits generated item prose, context-item parts of every producer, receipt metadata, prompts, private comparison state; no tool schemas or manifests are stored

#### Scenario: A failed Run's items stay private

- **WHEN** a publicly shared chat contains a failed Run whose messages carry the context items it dispatched
- **THEN** an anonymous or non-owner viewer sees that Run's ordinary user and assistant content
- **AND** those context-item parts are absent, as for a completed Run
