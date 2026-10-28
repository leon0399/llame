## MODIFIED Requirements

### Requirement: A model switch replaces the top-level prompt and preserves portable history

This rule applies to a turn whose selected model is different from the model of the reference
reply. The reference reply is the most recent prior assistant reply in the Chat whose sequence is
below the triggering user message. The status of
that reply, and whether a checkpoint absorbed it, do not change this rule. The request MUST use the
complete effective prompt of the target run as the only top-level system prompt. It MUST keep the
portable prior user and assistant history, and it MUST omit the prior top-level system prompts. It
MUST put a trusted model-switch reminder directly before the triggering user text. It MUST use the
runtime tool declarations of the target attempt.

Portable history MUST use the canonical replay projection. That projection holds visible user and
assistant text, owner `file` parts, and typed server-generated conversation checkpoints. It also
holds the replayed tool observations that the `tool-calling` capability requires, image `read`
results included. The system MUST project
each image reference in portable history for the declared input of the target model, as the
`media-attachments` capability defines. The target model can declare `image` input, and the epoch
image window can attach the reference. Then the reference is an image part, and in other cases it
is its placeholder text. The attached set MUST NOT depend on which vision model the request targets. A switch MUST NOT
change a stored part. An earlier model can receive an image as a placeholder. That image MUST reach
a later vision model as an image part when the epoch image window of that request attaches it.

The system MUST NOT make, change, or bind again the provider-native thinking, signature, or cache
metadata of an origin model for the target model. Reasoning parts and their provider metadata
replay under the `reasoning-output` capability. That capability gives each part back unchanged. It
omits before the request each part that the target wire cannot carry, and the target provider can
ignore or drop the rest. An unavailable target model MUST fail visibly, and the system MUST NOT run
a different model as fallback.

Tool observations are not display-only. The system replays them in the conventional tool-call and
tool-result form, in the form that the target provider expects after a model or provider switch.
Each replayed call comes with its result. Reasoning parts are also not display-only for the Chat
that stores them. `reasoning-output` replays each part and its provider metadata unchanged. The
system does not change it, and it does not select parts by their content. The selected adapter
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

- **WHEN** the selected model is the same as the model recorded on the most recent prior assistant reply in the Chat, whatever that reply's status
- **THEN** no model-switch reminder or model-switch UI boundary is created

#### Scenario: First turn in a chat

- **WHEN** a chat has no assistant reply with a sequence below the triggering user message
- **THEN** the selected model receives its effective prompt normally
- **AND** no model-switch reminder is created

The visible output and tool observations of a failed attempt MUST stay part of the committed
record. They MUST take part in later model context and compaction as the output of a successful
turn does, through the canonical replay projection. Their reasoning parts replay under
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
  epoch
- **THEN** the target's request attaches exactly the references the same turn's request would
  attach on the previous model
- **AND** every reference beyond the epoch's bounds keeps the limit placeholder

#### Scenario: A public-chat fork replays none of the source owner's media

- **WHEN** the owner of a fork of another owner's public Chat sends a turn with a model that declares
  `image` input
- **THEN** portable history carries no image part, placeholder, or `media://` locator for the source
  owner's attachments
- **AND** no media object owned by the source owner is resolved during preparation
