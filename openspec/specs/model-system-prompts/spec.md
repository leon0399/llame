# model-system-prompts

## Purpose

Per-model system prompts use operator-managed whole-file templates loaded by
execution workers at boot. Each execution attempt renders its system prompt
and llame-owned tool descriptions from one current safe context and admitted
runtime catalog. System-only attempt receipts preserve prepared prompt text;
attempt-owned conversation context and minimal tool-availability comparison
state persist when the request carrying them dispatches, whatever the Run's
outcome. Model switches preserve portable committed history. Owner-only
inspection exposes system receipts without tool catalogs, host paths, or
credentials.

## Requirements

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
context. Minimal id/state comparison records SHALL follow `tool-calling`, which
writes them when a Run dispatches and compares each attempt against the most
recent prior dispatched Run. Any permitted retry SHALL resolve and render its
system prompt and declarations again rather than using its predecessor's
receipt, catalog, or model context; its rail items follow the retry rule that
`context-injection` states, keeping the items an earlier attempt of the Run
stored and appending only newly derived ones.

#### Scenario: Settings change while queued

- **WHEN** the owner changes personalization after queue acceptance but before worker execution
- **THEN** the attempt uses the current owner projection in both prompt surfaces
- **AND** its receipt records its actual rendered system prompt

#### Scenario: Catalog changes before retry

- **WHEN** an infrastructure retry runs with a changed worker catalog
- **THEN** it admits and renders the new attempt's catalog
- **AND** it never loads a catalog or rendered description from the database

#### Scenario: A retry renders again but keeps stored rail items

- **WHEN** an attempt dispatched and stored accepted-turn rail items, and a
  later attempt of the same Run retries it
- **THEN** the retry resolves and renders its own system prompt and
  declarations and binds its own receipt
- **AND** it keeps the stored rail items unchanged and in place, appending only
  the items its comparison newly yields

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

### Requirement: A model switch replaces the top-level prompt and preserves portable history

This rule applies to a turn whose selected model is different from the model of the reference
reply. The reference reply is the most recent prior assistant reply in the Chat whose sequence is
below the triggering user message. The status of
that reply, and whether a checkpoint absorbed it, do not change this rule. The request MUST use the
complete effective prompt of the target run as the only top-level system prompt. It MUST keep the
portable prior user and assistant history, and it MUST omit the prior top-level system prompts. It
MUST put a trusted model-switch reminder directly before the triggering user text. It MUST use the
runtime tool declarations of the target attempt. For a model switch inside a Run, the reference
reply is the reply that the switch closed. The host message of the switch is the triggering message.

Portable history MUST use the projection of `turn-replay`. That projection holds visible user and
assistant text, owner `file` parts, and typed server-generated conversation checkpoints. It also
holds the replayed tool observations that the `tool-calling` capability requires, image `read`
results included. The system MUST project
each image reference in portable history for the declared input of the target model, as the
`media-attachments` capability defines. The target model can declare `image` input, and the epoch
image window can attach the reference. Then the reference is an image part, and in other cases it
is its placeholder text. Two target models can declare the same `image` and `pdf` input and the same
context window. Then the attached set MUST NOT depend on which of them the request targets. A switch
MUST NOT change a stored part. An earlier model can receive an image as a placeholder. That image MUST reach
a later vision model as an image part when the epoch image window of that request attaches it.

The system MUST NOT make, change, or bind again the provider-native thinking, signature, or cache
metadata of an origin model for the target model. Reasoning parts and their provider metadata
replay under the `reasoning-output` capability. After a model switch, it omits the reasoning parts of
the replies of other models. It gives back unchanged each part that its model rule keeps. An unavailable target model MUST fail visibly. The system MUST NOT run
a different model, except through the model switch of `model-roles`.

Tool observations are not display-only. The system replays them in the conventional tool-call and
tool-result form, in the form that the target provider expects after a model or provider switch.
Each replayed call comes with its result. Reasoning parts are also not display-only for the Chat
that stores them. `reasoning-output` selects them by the model of their reply, never by their
content, and replays each selected part and its provider metadata unchanged. The selected adapter
still omits a part that its wire cannot carry. This requirement forbids only one thing: llame MUST
NOT make, change, or bind again the provider metadata of an origin model for a different model.

#### Scenario: User sends the next turn with a different model

- **WHEN** the most recent prior assistant reply in the Chat records model `A` and the user sends the next message with model `B`
- **THEN** model `B` receives model `B`'s effective top-level system prompt and tool declarations
- **AND** portable earlier conversation turns remain in history
- **AND** model `A`'s system prompt is not replayed

#### Scenario: Earlier turn contains reasoning and tool activity

- **WHEN** an earlier assistant turn persisted reasoning, provider-native metadata, or settled tool activity/results alongside visible answer text
- **AND** a later turn uses the same model or switches providers or models
- **AND** the settled tool activity is above the active checkpoint's absorbed-through boundary, or no active checkpoint exists
- **THEN** the later model receives the visible answer text through the projection of `turn-replay`
- **AND** it receives the earlier tool observations in the target provider's expected representation, each call accompanied by its result
- **AND** the persisted reasoning parts that the model rule of `reasoning-output` keeps replay unchanged
- **AND** a switch omits the reasoning parts of other models, with no coercion or re-binding for the later model

#### Scenario: Target context window cannot fit portable history

- **WHEN** a turn switches from model `A` to smaller-context model `B` and the
  complete request for `B` would exceed its configured context window or
  reserved output budget
- **AND** model `A` served the previous completed Run, and it and its system-prompt receipt remain executable
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

- **WHEN** a model-switch turn selects an exact model that cannot execute
- **THEN** the run fails with the selected model's error
- **AND** no fallback model is invoked

#### Scenario: Same model continues

- **WHEN** the selected model is the same as the model recorded on the most recent prior assistant reply in the Chat, whatever that reply's status
- **THEN** no model-switch reminder or model-switch UI boundary is created

#### Scenario: First turn in a chat

- **WHEN** a chat has no assistant reply with a sequence below the triggering user message
- **THEN** the selected model receives its effective prompt normally
- **AND** no model-switch reminder is created

The visible output and tool observations of a failed attempt MUST stay part of the committed
record. They MUST take part in later model context and compaction as the output of a successful
turn does, through the projection of `turn-replay`. Their reasoning parts replay under
`reasoning-output`. One difference applies: a failed, cancelled, or expired Run gives no measured
context size, as the checkpoint contract below requires. Rail context that an attempt makes also
persists in the transaction that dispatches the model request that carries it. It persists on the
message of its trigger, and it stays in history as long as the output that it produced, as
`context-injection` specifies. Compaction MUST run in the Run's own attempt before its first model
step and MUST follow the checkpoint contract below. When the prepared request does not fit the
attempt's model, the summary MUST use the model of the previous completed Run. It MUST also use the
system-prompt receipt and the effort of that Run, and no tool declarations. It MUST NOT load, make
again, or persist a historical tool catalog.

#### Scenario: A switch to a text-only model replays images as placeholders

- **WHEN** earlier turns carry an owner `file` part and an image `read` result of `/work/shot.png`
  that a vision model received as image parts
- **AND** the next turn selects a model whose declared input is text only
- **THEN** that model receives the attachment, in its original position, as
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]`, and the
  read as `[image "/work/shot.png" <width>×<height>, omitted: this model has no image input]`
- **AND** the request carries no image part and the stored parts are unchanged

#### Scenario: A switch to a vision model restores stored image parts

- **WHEN** earlier turns of the current epoch ran on a text-only model and carry owner `file` parts
  and an image `read` result of `/work/shot.png`
- **AND** the next turn selects a model that declares `image` input
- **THEN** that model receives each stored image the epoch image window attaches as an image part
  built from its model variant
- **AND** each stored image beyond the epoch's bounds replays as
  `[image media://<id> <name> <width>×<height>, not attached: this context's image limit is reached]`
- **AND** the earlier read replays as an image part built from its retained model variant when the
  epoch image window attaches it

#### Scenario: A switch between vision models keeps the attached set

- **WHEN** a turn switches from one model that declares `image` input to another within the same
  epoch, and both models declare the same `image` and `pdf` input and the same context window
- **THEN** the target's request attaches exactly the references the same turn's request would
  attach on the previous model
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

#### Scenario: A public-chat fork replays none of the source owner's media

- **WHEN** the owner of a fork of another owner's public Chat sends a turn with a model that declares
  `image` input
- **THEN** portable history carries no image part, placeholder, or `media://` locator for the source
  owner's attachments
- **AND** no media object owned by the source owner is resolved during preparation

#### Scenario: A role moves to its next candidate

- **WHEN** a `@coding` Run fails on `codex`, and the owner continues it on the next candidate `sonnet`
- **THEN** `sonnet` receives its own system prompt and tool declarations, and the portable history
- **AND** the switch item of `model-roles` comes directly before the request of `sonnet`

### Requirement: Model switches use canonical persisted context text and metadata

The worker MUST prepare a server-authored context part when the selected model differs from the
baseline model. The baseline model is the model on the most recent prior assistant reply in the
Chat whose sequence is below the triggering user message. This applies whatever the status of that
reply, and whether or not a checkpoint absorbed it. A failed or cancelled reply counts, because its
switch item is already in history. The previous completed Run stays the source for the model and
the system-prompt receipt of compaction. A Run whose reply a Regenerate from `turn-actions`
replaced is not that Run; the Run that the reply usage names is. A running or finalized reply
records its model id in its usage. Thus each Run that dispatched a model request leaves a reply
that can be this baseline. The worker MUST persist that exact text on the triggering user message,
in the dispatch transaction of the first model request of the attempt. This applies whatever the
outcome of the Run. A retry of the same Run MUST keep the stored item unchanged. It MUST NOT add a second
switch item when one is already stored on the triggering user message. A stored `failover` item on
the triggering message counts as that item. A Continue Run MUST follow
the same rule as a retry. The first dispatch of a Regenerate Run MUST remove each model-switch item
with cause `model` or `failover` from the triggering user message. It then stores the item that its own
comparison yields, after the last stored context item. A retry of that Regenerate Run keeps the
item that its first dispatch stored. The producer MUST be
`effective-context-change`, the form MUST be `notice`, and `data.v` MUST stay `1`.

The producer MUST carry a closed cause vocabulary. In it, `model` covers a model change between
turns, and `failover` covers a model switch inside a Run, as `model-roles` defines. A cause
MUST be one value for each item. Causes at the same time that different producers own MUST stay
separate items. The item MUST keep the cause, the prior public model id, the target public model
id, and the target Run id as non-rendering metadata. The owner-facing boundary and provenance use
it.
It MUST NOT repeat dimensions that another producer owns, such as tool availability. It MUST also
persist the complete canonical model-facing reminder in `data.text`. The system MUST reject or
discard context parts that a client supplies.

For cause `model`, the persisted text MUST state that the active model changed before this user message. It MUST name
the prior model and the current model. Each name is the display name, then the public llame model
id, then the provider model id when the system knows it. The text MUST tell the assistant to follow
the current system instructions and to continue the current conversation. It MUST tell the
assistant not to start again, not to introduce itself again, and not to mention the model change
unless the user asks.

The system MUST render each model from a descriptor that the producer derives. The descriptor holds
the display name, the public llame model id, and the provider model id when known. Other catalog
values MUST NOT reach the body. The system MUST resolve the display name and the provider model id from
the configured model catalog when it authors the item. They MUST stay rendering values, not
persisted metadata. When the catalog has no name for a model, the public llame model id of that
model MUST fill its name slot. When the provider model id is unknown, the system MUST omit the
provider clause of that model and MUST NOT render it empty. A display name and a provider model id
are operator-authored text. The system MUST neutralize them under the reserved-delimiter rules of
`instance-config`, as it neutralizes an operator-authored catalog description. The public llame
model id MUST render raw.

Later request assembly MUST use `data.text` at its stored author-time position with the triggering
user text, in the producer order of `context-injection`. It MUST NOT rebuild the reminder from model
ids. The owner UI can use validated metadata, but a difference between metadata and text MUST NOT
change model replay.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch attempt is prepared and then dispatches its first model request
- **THEN** the dispatch transaction atomically persists its structured metadata and the complete reminder text on the triggering user message
- **AND** later request assembly uses that text and adds no other top-level system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior Run selected model `A`, dispatched a model request, and then failed, and the next turn selects model `B`
- **THEN** the new attempt compares model `B` with model `A` on the assistant reply of the failed Run
- **AND** the system persists a switch item from model `A` to model `B`, also when the last completed turn used model `B`
- **AND** a Run that failed before it dispatched any model request left no reply and is not the baseline

#### Scenario: A failed Run's switch is not announced twice

- **WHEN** a Run on model `B` follows a reply on model `A`, persists a switch item from `A` to `B` at dispatch, and then fails
- **AND** the next turn selects model `B` again
- **THEN** the next turn authors no model-switch item
- **AND** history still carries the switch item of the failed Run before its triggering user message

#### Scenario: Returning to the earlier model after a failed switch

- **WHEN** a Run persisted a switch item from model `A` to model `B` and then failed
- **AND** the next turn selects model `A`
- **THEN** that turn persists a switch item from model `B` to model `A`
- **AND** history does not let the model think that model `B` is still active

#### Scenario: A switch that forces compaction is still announced

- **WHEN** the most recent prior reply records model `A`, and the next turn selects model `B` with a smaller context
- **AND** the prepared request does not fit the window of model `B`
- **AND** the window variant publishes a checkpoint that absorbs the reply of model `A`
- **THEN** the attempt still compares model `B` with model `A` on that absorbed reply
- **AND** it persists a switch item from model `A` to model `B` at dispatch
- **AND** the request carries the checkpoint before that reminder and the triggering user text

#### Scenario: A checkpoint left by an undispatched Run does not hide the switch

- **WHEN** a reply records model `A`, and a later Run on model `B` publishes a checkpoint that absorbs that reply, then fails before it dispatches
- **AND** the next turn selects model `B`
- **THEN** that turn compares model `B` with model `A` on the absorbed reply
- **AND** it persists a switch item from model `A` to model `B`

#### Scenario: A retry reuses the stored switch item

- **WHEN** an attempt persisted a switch item at dispatch, and a later attempt of the same Run retries it
- **THEN** the request of the retry carries the stored switch item unchanged and in place
- **AND** the retry adds no second switch item, because one is already stored on the triggering user message

#### Scenario: Metadata and text disagree

- **WHEN** the metadata and the persisted text of a switch part disagree
- **THEN** the model receives the persisted text unchanged
- **AND** UI behavior validates the metadata independently

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a context-item part
- **THEN** the server does not persist or trust that part
- **AND** only server-derived Run state can create the switch item

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and the tool availability
- **THEN** the switch item names only the model cause
- **AND** the tool availability producer emits its own persisted reminder

#### Scenario: Both models are named with their catalog values

- **WHEN** the system authors a model-switch item, and the configured model catalog has a name and a provider model id for both models
- **THEN** the persisted text names the prior model and the current model
- **AND** each name is the display name, then the public llame model id, then the provider model id
- **AND** the metadata still carries only the cause, the two model ids, and the target Run id

#### Scenario: The configured catalog carries no name for a model

- **WHEN** the configured model catalog has no name for one of the two models when the system authors the item
- **THEN** the public llame model id of that model fills its name slot
- **AND** that id also renders in its own slot, so the text repeats it and does not omit the model

#### Scenario: The provider model id is unknown

- **WHEN** the configured model catalog has no provider model id for one of the two models when the system authors the item
- **THEN** the clause of that model omits the provider part fully
- **AND** the system renders no empty parenthesis and no substitute id

#### Scenario: A catalog-authored name carries a reserved delimiter

- **WHEN** the display name or the provider model id of a model contains the reserved delimiter name of the rail as a tag
- **THEN** the rendered body carries it neutralized as operator-authored text
- **AND** the public llame model id renders raw
- **AND** the rendered body contains one envelope

#### Scenario: An item persisted before the rendering change

- **WHEN** the system replays an item persisted before this change, or validates its metadata
- **THEN** its stored text replays unchanged, and its metadata still matches the exact model-change record
- **AND** the system renders no stored item again from current catalog values

#### Scenario: Regenerate with a new model replaces the switch item

- **WHEN** the first Run of a turn stored a switch item from model `A` to model `B`, and the owner regenerates the turn with model `C`
- **THEN** the Regenerate dispatch removes the stored item and stores a switch item from `A` to `C`

#### Scenario: Regenerate with the prior reply's model removes the switch item

- **WHEN** the first Run of a turn stored a switch item from model `A` to model `B`, and the owner regenerates the turn with model `A`
- **THEN** the Regenerate dispatch removes the stored item and stores no switch item

#### Scenario: A replaced Run is not the previous completed Run

- **WHEN** a Regenerate replaced the `completed` reply of Run `R1`, the Regenerate Run then failed, and the owner sends a new message
- **THEN** compaction for the new turn does not use `R1` as the previous completed Run

#### Scenario: A switch inside a Run has its own cause

- **WHEN** a Run switches from `codex` to `sonnet` after a failure
- **THEN** the host message of the switch carries one item with cause `failover`
- **AND** its text follows `model-roles`, not the text of cause `model`

#### Scenario: A failover item stops a second switch item

- **WHEN** the host message of a switch from `codex` to `sonnet` carries a `failover` item, and the new attempt prepares its request
- **THEN** the attempt stages no item with cause `model`

#### Scenario: A Regenerate of a switch turn

- **WHEN** the latest turn is the host message of a switch to `sonnet`, and the owner regenerates it with `opus`
- **THEN** the dispatch removes the `failover` item and stores an item with cause `model` from `codex` to `opus`

### Requirement: Compaction publishes a summary-only checkpoint before the Run's first model step

The worker MUST evaluate automatic compaction once before the first model step, against that attempt's prepared request. When a trigger applies, the worker MUST select exactly one variant. A request beyond the model window or reserved output budget MUST select the window variant, even above the threshold. Otherwise, measured context at or above the model threshold MUST select the threshold variant. The worker MUST NOT apply both variants.

Media overflow MUST also satisfy the threshold when two conditions hold. First, the request omits an image or PDF because the epoch media bounds are full. Second, a prior row contains a stored or retained reference of a kind the model accepts. The prior row MUST precede the triggering user message. A result without `media` or `retainedMedia` MUST NOT qualify. A non-fitting request MUST still select the window variant.

When no window, threshold, or media-overflow trigger applies, the request MUST proceed without compaction.

When media overflow alone triggers compaction, a failed summary MUST leave the attempt usable without a checkpoint. Overflowing references MUST retain their limit placeholders. The next Run MUST evaluate the trigger again. A successful checkpoint MUST start a new media epoch.

Measured context MUST use the previous completed reply's persisted final-request size plus estimated later rows and rail items. That reply MUST answer a user turn above the active checkpoint's absorbed boundary. Otherwise, estimate the complete request. Compare the answered user turn, not the assistant sequence. An in-place retry can retain an assistant sequence below a newer checkpoint. Failed, cancelled, or expired Runs MUST supply no measured context to a later trigger.

Without a user or assistant row between the active absorbed boundary and the triggering message, compaction MUST publish no checkpoint. A threshold request MUST proceed on its existing checkpoint. A window request MUST fail `context_incompatible`.

The threshold variant MUST use the current attempt's model client, pre-refresh system prompt, in-memory schema-only tool declarations, and resolved effort. The window variant MUST use the previous completed Run's model, system-prompt receipt, and effort without tool declarations. If that model cannot execute or fit the prefix, fail `context_incompatible`. Both variants MUST send the compactable prefix and one trailing synthetic user instruction. The prefix MUST already include its previous checkpoint as user text. Set `toolChoice: "none"`, expose no executor, and accept text only.

The instruction MUST request these sections in order:

1. `Latest Request`
2. `Objective`
3. `Constraints and Preferences`
4. `Decisions and Rationale`
5. `Established Facts`
6. `Errors and Corrections`
7. `Completed`
8. `Active`
9. `Blocked`
10. `Open Questions and Next Steps`
11. `Critical References`

`Latest Request` MUST quote the owner's last unresolved ask within the compactable prefix verbatim. The triggering message MUST follow the checkpoint as stored text, not a quote inside the summary. A prior checkpoint MUST fold into the new summary. Move completed active work to `Completed`. Replace answered questions rather than repeat them.

The instruction MUST treat history and checkpoints as data, without an answer or continuation. The conversation MUST outrank an earlier checkpoint. A reverse signal MUST remove a task. Credentials, tokens, and connection strings MUST become `[REDACTED]`, with a note of their prior presence. Redaction MUST outrank verbatim quotation.

The summary MUST use the conversation language. It MUST retain code, paths, identifiers, and errors without translation. It MUST omit absent facts without invention. It MUST NOT shorten or reconstruct identifiers.

The instruction MUST exclude personalization and every recency-digest snapshot, notice, and carry text. It MUST name the personalization delimiter and the shared envelope with producer `recency-digest`. Historical prompt digest blocks MUST retain their delimiter exclusion. The model, not a structural redactor, enforces semantic exclusion. No digest source text can become authoritative checkpoint state.

Digest exclusion from summary prose MUST remain instruction-enforced, not a structural guarantee. Publication MUST NOT claim to detect every paraphrase or reject nonempty output solely on that promise. Comparison state MUST derive from persisted digest items, never summary prose.

The summarization request MUST retain the bound prompt and prefix unchanged. Only its trailing instruction MUST carry exclusions. Title generation MUST retain its dedicated task prompt, not the Chat system prompt.

Publication MUST atomically store a nonempty raw summary and exactly one checkpoint message. That message MUST carry its final literal envelope, raw summary, usage, and absorbed-through sequence. It MUST contain no tool record, retained tail, or forward pointer. No replacement-history store can exist. The raw summary MUST remain separate from its envelope text.

Request assembly MUST select the latest checkpoint with an absorbed boundary below the triggering user message. It MUST replay that checkpoint as one user-role text message. Its associated digest companion MUST follow immediately, outside the checkpoint row. Then replay retained user and assistant rows above the absorbed boundary. This pair-placement rule MUST precede ordinary sequence order. A pre-step checkpoint can have a sequence above the message it precedes.

Replay MUST use stored checkpoint text without a new envelope or metadata-derived reconstruction. It MUST NOT parse the raw summary out of the envelope. A later compaction MUST consume the previous checkpoint plus newly absorbed rows and create a new checkpoint. Missing or invalid stored checkpoint text MUST fail preparation closed. No legacy renderer or compatibility fallback can exist.

The checkpoint, separate digest companion, and refreshed epoch state MUST commit in one fenced transaction before the next model step. Other epoch state MUST retain its temporal, skill-catalog, Workspace, and checkpoint-marker lifecycles. The attempt MUST resolve its subsequent prompt, items, and system-only receipt after that commit. Every refreshed value MUST affect that request. A later failure MUST preserve the published checkpoint and companion. Retry MUST reuse them without another summary call.

Publication MUST be idempotent across worker attempts. Stale work MUST NOT alter prepared live context. A digest companion MUST contain only its context item and MUST start no Run. Idle and step-boundary compaction MUST obey the same companion placement and persistence rule.

Estimate the actual request without a historical tool catalog. If the request still does not fit after this compaction, fail `context_incompatible`. Committed failed-attempt output MUST enter compaction like other committed history. Preserve the history boundary of context-injection. The stored checkpoint envelope MUST state that work can already affect session state. It MUST direct the assistant not to repeat that work.

#### Scenario: A pre-step trigger compacts before the first model request

- **WHEN** a prepared Run request reaches its threshold or exceeds its model window
- **AND** a user or assistant row sits between the active absorbed boundary and the triggering message
- **THEN** the selected variant summarizes before the first model step
- **AND** its checkpoint, raw summary, and required companion commit atomically before that step

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

- **WHEN** the summarization instruction renders
- **THEN** it specifies data-only history, conversation precedence, cancelled-task removal, and credential redaction
- **AND** it preserves language, code, paths, identifiers, and errors without invented facts

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
- **THEN** its stored envelope states that the session state can already reflect
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

- **WHEN** a Run prepares after a checkpoint publication
- **THEN** assembly emits its current prompt and tools, checkpoint, associated digest companion, and retained rows
- **AND** replay uses stored checkpoint text without reconstruction

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
- **THEN** that attempt resolves its own system prompt, its rail items,
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

- **WHEN** a fitting image-capable request exceeds epoch image bounds and a prior row holds an accepted image reference
- **THEN** the attempt selects the threshold variant before its first model step
- **AND** the new epoch admits images oldest first

#### Scenario: Image overflow in the triggering message alone does not compact

- **WHEN** only the triggering user message's own images exceed the epoch's
  bounds and no row before it carries a stored image or PDF reference
- **THEN** no checkpoint is published
- **AND** the overflowing images keep the limit placeholder and the attempt
  proceeds

#### Scenario: A stored PDF does not enable image overflow without PDF input

- **WHEN** a prepared request on a model that declares `image` but not `pdf`
  input carries only a stored PDF in the rows before the triggering user
  message, and that message's own images exceed the epoch's bounds
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

#### Scenario: PDF overflow selects the threshold variant

- **WHEN** a fitting PDF-capable request exceeds epoch PDF bounds and a prior row holds an accepted PDF reference
- **THEN** the attempt selects the threshold variant before its first model step
- **AND** the new epoch admits PDFs oldest first

#### Scenario: Compaction keeps the digest outside its summary row

- **WHEN** a checkpoint publishes with effective digest state
- **THEN** a separate atomic companion carries that state immediately after the checkpoint
- **AND** the checkpoint row contains only its summary part

### Requirement: Summarization instructions and the title prompts are packaged templates

Each owning module MUST package its summary instruction and title prompts as template files. They MUST use the producer-owned-values engine of context-injection. No operator key can select, replace, or disable them. They MUST remain outside system-prompt receipts.

Title prompts MUST retain their prior inline bytes. The summary template MUST contain the required sections and context exclusions. It MUST name the personalization delimiter and the shared envelope with producer `recency-digest`. Historical prompt digest blocks MUST retain their delimiter exclusion. Independently authored literal expectations MUST verify those contracts. The check MUST NOT compare a template with itself or derive both sides from one shared constant.

#### Scenario: Compaction request is unchanged by the template migration

- **WHEN** a checkpoint is created after the two summarization instructions
  merge
- **THEN** its trailing instruction is rendered from the single packaged
  summarization template
- **AND** the bound prompt, compactable prefix, and schema-only tool declarations
  of that request are unchanged

#### Scenario: Instruction template omits a stable section or the digest exclusion

- **WHEN** a packaged instruction template no longer contains one of the required
  section headings or no longer names the `recency-digest` producer under the
  shared envelope
- **THEN** the compaction contract check fails against its independently authored literal text
- **AND** a self-comparison cannot hide the omission

#### Scenario: Title generation keeps its dedicated prompts

- **WHEN** the system generates a Chat title
- **THEN** it uses its packaged title system and user prompts with unchanged prior bytes
- **AND** it uses no Chat system prompt or personalization

#### Scenario: No configuration replaces an instruction template

- **WHEN** an operator configuration attempts to name a replacement for a summarization instruction or a title prompt
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use

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
owner-only persisted model-visible context-item parts; operator skill source/package/file
paths intentionally published under `agent-skills` SHALL likewise be permitted
in persisted model-visible skill contributions. These host-path exceptions SHALL
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
- **THEN** the immutable enqueue receipt stays unchanged and the final activation text is persisted as a context-item part on the message its trigger belongs to
- **AND** the skill path exception does not expose Knowledge backing paths or private prompt configuration

#### Scenario: Queued receipt is pending

- **WHEN** an owner inspects a Run before any attempt has prepared its system prompt
- **THEN** the response identifies it as not yet resolved with no fabricated prompt or tool data
- **AND** a non-owner requesting the same Run receives not found

#### Scenario: Retry renders different personalization

- **WHEN** a retry renders a different system prompt from an earlier failed attempt
- **THEN** both prepared attempts have separate immutable system-only receipts
- **AND** the retry keeps the accepted-turn context items stored by the earlier attempt and appends only newly derived ones, while the earlier attempt's in-Run context items leave history together with its output when the retry's dispatch resets the reply

#### Scenario: Owner inspects Workspace paths in effective context

- **WHEN** the chat owner opens an effective-context receipt for a Run whose `workspace` producer narrated a canonical Workspace root and whose Workspace skill activation published source, package, or file paths
- **THEN** the owner can see the canonical Workspace root and Workspace skill source/package/file paths in the persisted model-visible context-item parts
- **AND** prompt-file paths, Knowledge backing paths, credentials, and other private configuration remain undisclosed

### Requirement: Model context is surfaced as progressive disclosure

The owner transcript SHALL render a compact model-switch boundary immediately before the triggering user message. Its collapsed state SHALL identify the public prior and target models; public model ids that exceed the available width SHALL use a single-line ellipsis, and a tooltip SHALL expose only the full id values that are actually truncated. Its expanded state SHALL explain that the selected model changed; the system prompt resolves when its worker attempt starts and provide access to the target run's receipt. Every new assistant turn SHALL also provide an owner-only effective-context action near its model/usage metadata. Receipt contents SHALL load on demand rather than being embedded in every history response.

#### Scenario: Owner views a switched turn

- **WHEN** the owner loads a chat containing a persisted model-switch part
- **THEN** a compact boundary appears immediately before the triggering user message
- **AND** expanding it gives access to the target Run's system-only attempt receipts or not-yet-resolved state

#### Scenario: Owner inspects a turn without a switch

- **WHEN** the owner views an assistant turn that continued with the same model
- **THEN** no switch boundary is shown
- **AND** the turn's effective-context action still opens its receipt

#### Scenario: A public model id exceeds the boundary width

- **WHEN** either public model id cannot fit in the collapsed model-switch boundary
- **THEN** that displayed id is truncated with an ellipsis instead of wrapping or breaking
- **AND** focusing or hovering the existing disclosure control shows the complete value for each truncated id
- **AND** complete values for ids that were not truncated are not redundantly added to the tooltip

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

### Requirement: A compaction Run absorbs every committed row

A compaction Run MUST absorb every user and assistant row whose sequence is above the
absorbed-through sequence of the active checkpoint. It MUST hold no row back. Its summary
instruction MUST omit the sentence about a newer user message that follows the absorbed rows. All
other text of the summary instruction MUST stay the same.

#### Scenario: The next turn sees only the checkpoint

- **WHEN** a compaction Run publishes a checkpoint and the owner then sends a message
- **THEN** the request of the next turn holds that checkpoint and the new message
- **AND** it holds no row that the checkpoint absorbed

#### Scenario: The instruction has no trigger sentence

- **WHEN** a compaction Run sends its summary request
- **THEN** the instruction does not tell the model that a newer user message follows the absorbed rows
- **AND** it still tells the model to fold an earlier checkpoint

### Requirement: A compaction Run request reuses a stored system prompt

This requirement applies when the absorbed rows fit the model of a compaction Run. Its summary
request MUST hold the stored receipt prompt of its source Run, the absorbed rows, and the
instruction last. The source Run is the Run of the newest completed reply. With no source Run, it
MUST send no system prompt. It MUST send no tool declarations, and it MUST bind no receipt.

#### Scenario: The summary request of a compaction Run

- **WHEN** a compaction Run with model `B` sends its summary request, and its source Run used model `A`
- **THEN** the request holds the receipt prompt of the source Run and no tool declarations
- **AND** the compaction Run has no system-prompt receipt

#### Scenario: A compaction Run with no source Run

- **WHEN** every earlier turn Run of the Chat failed, and the owner compacts
- **THEN** the summary request holds no system prompt

### Requirement: A failed compaction Run fails

When the summary request of a compaction Run fails or returns no usable summary, the Run MUST end
`failed` with the error. It MUST NOT publish a checkpoint. The rule that a failed overflow
compaction never fails its Run MUST NOT apply to a compaction Run.

#### Scenario: A provider error during a compaction Run

- **WHEN** the provider answers the summary request of a compaction Run with an error
- **THEN** the Run is `failed`, and the Chat has no new checkpoint

### Requirement: A step-boundary compaction absorbs the turn so far

A turn Run can compact at a step boundary. The checkpoint MUST then absorb every user and assistant
row above the active checkpoint, the user message of the current segment, and its closed reply.
The summary instruction MUST omit the sentence about a newer user message. All other text of the
instruction MUST stay the same.

#### Scenario: A compaction in a tool loop absorbs the open turn

- **WHEN** a turn Run compacts after its third tool step
- **THEN** the checkpoint absorbs the user message of the Run and the reply with its three tool calls
- **AND** no tool call or tool result of that reply follows the checkpoint

### Requirement: A step-boundary compaction continues the live request

The summary request of a step-boundary compaction MUST use the model, the effort, the system prompt,
and the tool declarations of the live request. Its rows MUST be the stored replay of the absorbed
rows, with the closed reply last. The summary instruction MUST be its last user message.

#### Scenario: The summary request reuses the live prefix

- **WHEN** a turn Run on model `A` with effort `high` compacts at a step boundary
- **THEN** the summary request uses model `A`, effort `high`, the same system prompt, and the same tool declarations

### Requirement: The continue notice carries the current request

The `compaction` notice item of a continue message MUST tell the model that the conversation was
compacted. It MUST tell the model to continue its task from the checkpoint. It MUST then quote the text of the
newest owner message of the Run, at most 4,000 characters. A Run with no owner message gets no
quote. The item MUST NOT be a text part.

#### Scenario: The model sees the request after a compaction

- **WHEN** the owner asked `migrate the auth module to sessions`, and the Run compacts mid-turn
- **THEN** the next request holds the checkpoint, then a `compaction` item that quotes `migrate the auth module to sessions`

### Requirement: A failed step-boundary compaction continues the Run

When the summary request of a step-boundary compaction fails or returns no usable summary, the Run
MUST NOT publish a checkpoint. It MUST continue as if no compaction was due. It MUST record the
failure as a Run event, and the web MUST show it in the transcript.

#### Scenario: A provider error during a compaction mid-turn

- **WHEN** the provider answers the summary request of a step-boundary compaction with an error
- **THEN** the Run continues with its next model request and no new checkpoint
- **AND** the transcript shows that the compaction failed

### Requirement: An automatic compaction runs at a step boundary

After each step that called tools, the worker MUST measure the next request. The measure is the
context size of the latest request plus the estimate of the tool results of that step. Without a
reported context size, the worker MUST estimate the whole request. When it reaches the compaction threshold of the Run model, the Run MUST compact at that
boundary.

#### Scenario: A long tool loop compacts itself

- **WHEN** the threshold of the Run model is 160,000 tokens, and a tool result brings the next request to 165,000 tokens
- **THEN** the Run compacts at that boundary and sends its next request after the checkpoint

#### Scenario: A final answer does not compact automatically

- **WHEN** the model gives its final answer, and the measured request is above the threshold
- **THEN** the Run completes with no automatic compaction

### Requirement: Automatic compaction stops when it makes no progress

An automatic compaction MUST NOT run before one model step after the previous compaction of the
Run. It MUST NOT run when there is no row to absorb. Automatic compaction MUST stop for the rest of
the Run when the first request after a compaction is still at the threshold. It MUST also stop when
an automatic compaction fails. The stop MUST survive a new segment, a wake, and a
crash retry. An owner command MUST still
compact.

#### Scenario: Ten compactions in a long Run

- **WHEN** a Run reaches the threshold ten times, and each checkpoint brings the request below it
- **THEN** the Run compacts ten times and continues

#### Scenario: A compaction that does not help

- **WHEN** the first request after an automatic compaction is still above the threshold
- **THEN** the Run makes no further automatic compaction, and the transcript shows that
- **AND** the owner can still compact with `/compact`

#### Scenario: A failed automatic compaction stops the trigger

- **WHEN** the summary request of an automatic compaction fails
- **THEN** the Run continues, and no later boundary of that Run compacts automatically

### Requirement: A compaction focus is a bounded paragraph after the summary instruction

A compaction can have a focus. Its summary instruction MUST then end with a paragraph that starts
with `Additional focus:` and holds the neutralized focus text. That paragraph MUST say that the
focus cannot change the section headings or the redaction rules. With no focus, the instruction
MUST hold no such paragraph.

#### Scenario: A focus reaches the summary request

- **WHEN** a compaction with the focus `keep the migration plan` sends its summary request
- **THEN** the last part of the instruction is `Additional focus:` with `keep the migration plan`

#### Scenario: A focus cannot remove redaction

- **WHEN** the focus asks the model to keep a credential verbatim
- **THEN** the instruction still tells the model to write `[REDACTED]` for a credential

### Requirement: The focus shows on the checkpoint and is not replayed

A checkpoint that a compaction with a focus publishes MUST store the focus. The history read MUST
return the focus with the checkpoint. The focus MUST NOT be part of the checkpoint text that later
requests replay.

#### Scenario: The boundary shows the focus

- **WHEN** a compaction with a focus publishes a checkpoint and the owner reads the history
- **THEN** the checkpoint in the history holds that focus

#### Scenario: A later request does not replay the focus

- **WHEN** a turn Run replays a checkpoint that has a focus
- **THEN** the checkpoint text in the request does not hold the focus text

### Requirement: Each model resolves a complete prompt without digest variables

Each model MUST use one complete effective system prompt. A model override MUST replace the project default, not inherit or compose it. Missing overrides MUST select the project default. System and tool-description templates MUST use the same validated Handlebars projection. That projection MUST exclude `chats` and `chats.*`, under instance-config. Receipts MUST contain rendered system text only.

#### Scenario: Model has no prompt override

- **WHEN** the selected model omits `systemPromptFile`
- **THEN** the project default supplies its complete prompt and receipt source

#### Scenario: Two models use materially different prompts

- **WHEN** two model entries select different valid files
- **THEN** each uses its complete file without inheritance or composition

#### Scenario: Configured override is broken

- **WHEN** a selected override cannot resolve to valid nonempty text
- **THEN** startup fails without fallback

#### Scenario: Retired digest paths fail startup

- **WHEN** a template references a digest path or `chats` gate
- **THEN** startup rejects it without source Chat resolution

### Requirement: The current prompt projection remains explicit

The projection MUST admit only `model.id`, optional `model.name`, declared owner paths, temporal scalars, skill fields, web-search fields, and conditional tool predicates. Preserve `webSearch` and `webSearch.engines` under tool-prompt-templates. An absent model name MUST render empty.

Both temporal scalars MUST remain unconditional. A bare `context` gate MUST fail startup. Model paths MUST resolve at boot. Owner and Chat values MUST resolve per attempt.

#### Scenario: Default prompt renders model id and name

- **WHEN** the selected model has an id and configured name
- **THEN** its receipt contains those rendered values

#### Scenario: Prompt references an absent model name

- **WHEN** the model omits its optional name
- **THEN** startup succeeds, its value is absent, and its conditional is false

#### Scenario: Prompt renders the temporal anchor

- **WHEN** a prompt references both temporal scalars
- **THEN** it renders the absolute timestamp, numeric UTC offset, and IANA timezone

#### Scenario: Temporal namespace is guarded as though it were optional

- **WHEN** a prompt checks the bare `context` namespace
- **THEN** startup rejects that construct without prompt contents

#### Scenario: Prompt references no temporal path

- **WHEN** a prompt omits both temporal scalars
- **THEN** the omitted anchor contributes no bytes

#### Scenario: Per-user paths survive boot unresolved

- **WHEN** a template references allowlisted owner paths
- **THEN** boot validates them without an owner lookup
- **AND** each attempt resolves the current values

### Requirement: Template syntax stays closed and single-pass

Validation MUST admit literal content, allowed values, comments, and `if`, `unless`, and `each` blocks only. It MUST reject partials, decorators, unescaped output, unknown paths, and other helpers. Parsed path segments and depth MUST govern admission. Blocks MUST accept exactly one parameter without hash arguments or block parameters. Rendered values MUST NOT undergo another parse. Literal engine escapes and whitespace-control syntax can remain.

#### Scenario: Literal expression is emitted

- **WHEN** a template uses the engine literal escape
- **THEN** the expression stays literal without recursive evaluation

#### Scenario: Prompt uses a conditional

- **WHEN** an allowed value controls an `if` block
- **THEN** only the applicable branch renders

#### Scenario: Prompt contains a disallowed construct

- **WHEN** a template uses an unknown path, partial, unescaped value, or forbidden helper
- **THEN** startup rejects the model and construct without source contents

#### Scenario: Rendered output is not re-evaluated

- **WHEN** an owner value contains template syntax
- **THEN** that syntax remains literal text

### Requirement: Template iteration stays bounded to declared fields

`each` MUST accept only an allowlisted collection. It MUST reject scalars, gates, nested iteration, index/key variables, hash arguments, and block parameters. Item expressions MUST use declared fields only. Collections MUST NOT render as scalar values. `skills.entries` MUST expose only `name` and `description`, in code-point name order. `skills.omitted` MUST be a non-iterable integer that is false at zero.

#### Scenario: Prompt iterates an allowlisted collection

- **WHEN** an `each` block selects `skills.entries` and its declared fields
- **THEN** one body renders per entry

#### Scenario: Iteration references an undeclared item field

- **WHEN** an iteration uses an undeclared field
- **THEN** startup rejects it without Chat disclosure

#### Scenario: Iteration is attempted over a non-collection

- **WHEN** `each` targets a scalar, gate, or unknown path
- **THEN** startup fails before any Run

#### Scenario: Iteration uses a forbidden escape construct

- **WHEN** a template uses nested iteration, index/key variables, hashes, or block parameters
- **THEN** startup rejects each construct

#### Scenario: Prompt iterates the skill catalog

- **WHEN** a template emits skill names and descriptions
- **THEN** entries follow code-point name order and descriptions receive tag neutralization

#### Scenario: A prompt gates an overflow line on the omitted count

- **WHEN** a template checks `skills.omitted`
- **THEN** the line appears only for a nonzero count
- **AND** iteration over that scalar fails

#### Scenario: A collection is emitted as a value

- **WHEN** a template emits `skills.entries` as a scalar
- **THEN** startup fails rather than stringify its structure

### Requirement: Owner and skill gates remain independent and absent-safe

Absent or whitespace-only owner fields MUST be absent from the projection. Empty personalization MUST remove that gate. No owner content MUST remove `user`. No proactively admitted skill entry MUST remove `skills`.

Boot MUST probe independent `user`, `skills`, and `webSearch` gate combinations with a representative anchor. It MUST reject every empty result. Tool predicates MUST follow tool-prompt-templates without an exhaustive membership probe.

#### Scenario: An entire skills section is gated on an admitted entry

- **WHEN** a template checks `skills`
- **THEN** its section appears only with admitted entries

#### Scenario: Boot records whether a template references the catalog

- **WHEN** worker boot validates a model template
- **THEN** turn preparation receives its skills-reference flag

#### Scenario: Skills gate is independent of the other gates

- **WHEN** a template becomes empty for only one owner/skills combination
- **THEN** boot detects that combination and rejects it

#### Scenario: Prompt references no per-user path

- **WHEN** a prompt has no owner expression
- **THEN** startup succeeds without personalization bytes

#### Scenario: Owner value absent at render time

- **WHEN** an owner field has no nonempty value
- **THEN** it remains absent, renders empty, and tests false

#### Scenario: An entire section is gated on the owner having any per-user context

- **WHEN** the owner supplies no profile or shared identity
- **THEN** the `user` section and its prose disappear

#### Scenario: Template renders non-empty without an owner

- **WHEN** a template becomes empty for an unpersonalized owner
- **THEN** boot rejects that empty combination

#### Scenario: Template is empty only for one gate combination

- **WHEN** one independent owner/skills combination yields empty text
- **THEN** the boot cross product rejects it

#### Scenario: Every boot probe carries an anchor

- **WHEN** boot probes the independent gates
- **THEN** each probe supplies a representative temporal anchor

### Requirement: Prompt values keep their escaping and omission rules

Model values, account identity, and grammar-constrained skill names MUST escape exactly `&`, `<`, and `>`. Owner-authored values and skill descriptions MUST use instance-config tag neutralization. Projection MUST apply those rules without a global engine-escape change. Catalog omission MUST retain its frozen-baseline semantics. Digest disclosure MUST use its own rail lifecycle and cannot make `user` present.

#### Scenario: Digest presence does not make the personalization gate true

- **WHEN** the owner has digest context but no profile or shared identity
- **THEN** the `user` gate remains false

#### Scenario: A prompt does not require a digest gate

- **WHEN** the digest has no eligible Chats
- **THEN** the system prompt has no digest field or empty digest framing

### Requirement: Owner prompt paths remain a closed projection

The owner paths MUST remain exactly `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`. The temporal scalars MUST remain exactly `context.systemTime` and `context.systemTimezone`. Skill fields MUST remain the declared `skills.entries` item fields and `skills.omitted`. No prefix-path wildcard can expose other configuration or owner data.

#### Scenario: An undeclared owner field remains unavailable

- **WHEN** a configured template references another owner field
- **THEN** boot rejects the unknown path without an owner lookup
