## MODIFIED Requirements

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
- **AND** a switch omits them, with no coercion or re-binding for the later model

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
