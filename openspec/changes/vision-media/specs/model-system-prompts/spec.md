## MODIFIED Requirements

### Requirement: A model switch replaces the top-level prompt and preserves portable history

For a turn whose selected model differs from the most recent successfully committed prior run in the chat, the request SHALL use the target run's complete effective prompt as the sole top-level system prompt. It SHALL retain portable prior user/assistant history, omit prior top-level system prompts, include a trusted model-switch reminder immediately before the triggering user text, and use the target attempt's runtime tool declarations. Portable history SHALL use the canonical replay projection of visible user/assistant text, owner `file` parts, typed server-generated conversation checkpoints, and the replayed tool observations required by the `tool-calling` capability, image `read` results included. Every image reference in portable history SHALL be projected for the target model's declared input as the `media-attachments` capability defines: an image part when the target model declares `image` input and the epoch image window attaches the reference, and its placeholder text otherwise. The attached set SHALL NOT depend on which vision model the request targets. A switch SHALL NOT rewrite a stored part, and an image an earlier model received as a placeholder SHALL reach a later vision model as an image part when that request's epoch image window attaches it. It MUST NOT synthesize, rewrite, or re-bind an originating model's provider-native thinking/signature/cache metadata for the target model; reasoning parts and their provider metadata replay under the `reasoning-output` capability, which passes each part back unchanged, omits before the request any part the target wire cannot represent, and lets the target provider ignore or drop the rest. An unavailable target model SHALL fail transparently; the system MUST NOT execute another model as fallback.

Tool observations are no longer display-only. They are replayed in the conventional tool-call/tool-result representation, carried across a model or provider switch in the target provider's expected form, with every replayed call accompanied by its result. Reasoning parts are likewise no longer display-only for the Chat that stores them: `reasoning-output` replays each part and any provider metadata it carries, unchanged; the system neither coerces it nor selects which parts to keep by content, while the selected adapter still omits a part its wire cannot represent. What this requirement still forbids is llame synthesizing, rewriting, or re-binding an originating model's provider metadata for a different model.

#### Scenario: User sends the next turn with a different model

- **WHEN** the previous successfully committed run selected model `A` and the user sends the next message with model `B`
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
- **AND** model `A` plus its most recent system-prompt receipt remain executable
- **THEN** the worker compacts with model `A` over history through the last
  assistant turn before invoking model `B`
- **AND** the triggering user message remains outside the summarized prefix
- **AND** model `B` receives its own prompt and tools, the resulting checkpoint
  message, the user and assistant rows above its absorbed-through sequence, and
  the switch reminder plus triggering user text

#### Scenario: No capable source model is available

- **WHEN** the target request does not fit and the prior model or its successful
  system-prompt receipt is unavailable or the source-model compaction fails
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

- **WHEN** the selected model is the same as the most recent successfully committed prior run
- **THEN** no model-switch reminder or model-switch UI boundary is created

#### Scenario: First turn in a chat

- **WHEN** a chat has no prior successfully committed run
- **THEN** the selected model receives its effective prompt normally
- **AND** no model-switch reminder is created

Failed-attempt visible output and tool observations SHALL remain part of the committed record and participate in later model context and compaction exactly as a successful turn's do, through the canonical replay projection, with their reasoning parts replayed under `reasoning-output`, except that a failed, cancelled, or expired Run supplies no measured context size, as the checkpoint contract below requires; only attempt-generated rail context stays staged and publishes with a successful turn. Compaction SHALL run in the Run's own attempt before its first model step and SHALL follow the checkpoint contract below. When the prepared request does not fit that attempt's model, the summary SHALL use the previous completed Run's model, that Run's system-prompt receipt and effort, and no tool declarations; it SHALL NOT load, reconstruct, or persist a historical tool catalog.

#### Scenario: A switch to a text-only model replays images as placeholders

- **WHEN** earlier turns carry an owner `file` part and an image `read` result that a vision model
  received as image parts
- **AND** the next turn selects a model whose declared input is text only
- **THEN** that model receives each earlier image, in the image's original position, as its
  placeholder `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`
- **AND** the request carries no image part and the stored parts are unchanged

#### Scenario: A switch to a vision model restores image parts

- **WHEN** earlier turns of the current epoch ran on a text-only model and carry owner `file` parts
  and an image `read` result
- **AND** the next turn selects a model that declares `image` input
- **THEN** that model receives each image the epoch image window attaches as an image part built from
  its model variant
- **AND** each image beyond the epoch's bounds replays as
  `[image media://<id> <name> <width>×<height>, not attached: this context's image limit is reached]`

#### Scenario: A switch between vision models keeps the attached set

- **WHEN** a turn switches from one model that declares `image` input to another within the same
  epoch
- **THEN** the target's request attaches exactly the references the previous request attached
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

#### Scenario: A public-chat fork replays none of the source owner's media

- **WHEN** the owner of a fork of another owner's public Chat sends a turn with a model that declares
  `image` input
- **THEN** portable history carries no image part, placeholder, or `media://` locator for the source
  owner's attachments
- **AND** no media object owned by the source owner is resolved during preparation

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

A prepared request on a model that declares `image` input SHALL also count as
reaching the Run model's threshold when it carries an image reference that
`media-attachments` does not attach because its epoch's image bounds are reached
and an image reference in a row before the triggering user message. Image
overflow SHALL therefore select the threshold variant on the attempt's own
model, because that request fits; a request that also does not fit SHALL select
the window variant as above.

When image overflow is the only trigger condition and its compaction fails or
yields no usable summary, the attempt SHALL proceed without a checkpoint and the
overflowing references SHALL keep the limit placeholder that `media-attachments`
defines; image overflow alone SHALL NOT fail an attempt. The trigger SHALL be
evaluated again before every Run's first model step, so those references stay
unattached only until the next Run whose compaction succeeds and starts a new
epoch.

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
checkpoint instead of paying a second summary call. Publication SHALL be
idempotent across a worker-attempt cutover, and stale work SHALL NOT alter a
prepared live attempt's context.

Compaction SHALL estimate the request actually sent and SHALL NOT load,
reconstruct, or persist a historical tool catalog. Tool execution remains
disabled. If the request still does not fit after that one compaction, the
attempt SHALL fail `context_incompatible`. Post-cutover failed-attempt output
SHALL remain part of the record and enter compaction input like any other
committed turn; only its staged rail items withhold until a successful turn.
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

#### Scenario: Image overflow selects the threshold variant

- **WHEN** a prepared request on a model that declares `image` input fits that
  model's window and its measured context size is below the threshold, but it
  carries an image reference beyond its epoch's image bounds and an image
  reference in a row before the triggering user message
- **THEN** the threshold variant runs before the Run's first model step, with
  that attempt's own model client, system prompt, schema-only tool declarations,
  and effort
- **AND** the request after the checkpoint admits images oldest first under the
  new epoch

#### Scenario: Image overflow in the triggering message alone does not compact

- **WHEN** only the triggering user message's own images exceed the epoch's image
  bounds and no row before it carries an image reference
- **THEN** no checkpoint is published
- **AND** the overflowing images keep the limit placeholder and the attempt
  proceeds

#### Scenario: Image overflow alone never fails an attempt

- **WHEN** image overflow is the only trigger condition and its summarization
  call throws or returns no usable summary
- **THEN** the attempt proceeds without a checkpoint instead of failing
  `context_incompatible`
- **AND** the overflowing images keep the limit placeholder
- **AND** the next Run evaluates the trigger again before its first model step
  and, when its compaction succeeds, admits images oldest first under the new
  epoch
