## MODIFIED Requirements

### Requirement: A model switch replaces the top-level prompt and preserves portable history

For a turn whose selected model differs from the most recent successfully committed prior run in the chat, the request SHALL use the target run's complete effective prompt as the sole top-level system prompt. It SHALL retain portable prior user/assistant history, omit prior top-level system prompts, include a trusted model-switch reminder immediately before the triggering user text, and use the target attempt's runtime tool declarations. Portable history SHALL use the canonical replay projection of visible user/assistant text, owner `file` parts, typed server-generated conversation checkpoints, and the replayed tool observations required by the `tool-calling` capability, image `read` results included. Every image reference in portable history SHALL be projected for the target model's declared input as the `media-attachments` capability defines: an image part when the target model declares `image` input and the reference falls inside the image window, and its placeholder text otherwise. A switch SHALL NOT rewrite a stored part, and an image an earlier model received as a placeholder SHALL reach a later vision model as an image part when it falls inside that request's window. It MUST NOT synthesize, rewrite, or re-bind an originating model's provider-native thinking/signature/cache metadata for the target model; reasoning parts and their provider metadata replay under the `reasoning-output` capability, which passes each part back unchanged, omits before the request any part the target wire cannot represent, and lets the target provider ignore or drop the rest. An unavailable target model SHALL fail transparently; the system MUST NOT execute another model as fallback.

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
- **THEN** that model receives each earlier image as its placeholder
  `[image media://<id> <name> <width>×<height>, omitted: this model has no image input]` in the image's original position
- **AND** the request carries no image part and the stored parts are unchanged

#### Scenario: A switch to a vision model restores image parts

- **WHEN** earlier turns ran on a text-only model and carry owner `file` parts and an image `read`
  result inside the image window of the next request
- **AND** the next turn selects a model that declares `image` input
- **THEN** that model receives each of those images as an image part built from its model variant
- **AND** each earlier image outside that window still replays as its placeholder

#### Scenario: A public-chat fork replays none of the source owner's media

- **WHEN** the owner of a fork of another owner's public Chat sends a turn with a model that declares
  `image` input
- **THEN** portable history carries no image part, placeholder, or `media://` locator for the source
  owner's attachments
- **AND** no media object owned by the source owner is resolved during preparation
