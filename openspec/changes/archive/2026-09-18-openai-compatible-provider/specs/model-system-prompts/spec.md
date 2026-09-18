## MODIFIED Requirements

### Requirement: A model switch replaces the top-level prompt and preserves portable history

For a turn whose selected model differs from the most recent successfully committed prior run in the chat, the request SHALL use the target run's complete effective prompt as the sole top-level system prompt. It SHALL retain portable prior user/assistant history, omit prior top-level system prompts, include a trusted model-switch reminder immediately before the triggering user text, and use the target attempt's runtime tool declarations. Portable history SHALL use the canonical replay projection of visible user/assistant text, typed server-generated conversation checkpoints, and the replayed tool observations required by the `tool-calling` capability. It MUST NOT synthesize, rewrite, or re-bind an originating model's provider-native thinking/signature/cache metadata for the target model; reasoning parts and their provider metadata replay under the `reasoning-output` capability, which passes each part back unchanged, omits before the request any part the target wire cannot represent, and lets the target provider ignore or drop the rest. An unavailable target model SHALL fail transparently; the system MUST NOT execute another model as fallback.

Tool observations are no longer display-only. They are replayed in the conventional tool-call/tool-result representation, carried across a model or provider switch in the target provider's expected form, with every replayed call accompanied by its result. Reasoning parts are likewise no longer display-only for the Chat that stores them: `reasoning-output` replays each part and any provider metadata it carries, unchanged; the system neither coerces it nor selects which parts to keep by content, while the selected adapter still omits a part its wire cannot represent. What this requirement still forbids is llame synthesizing, rewriting, or re-binding an originating model's provider-native metadata for a different model.

#### Scenario: User sends the next turn with a different model

- **WHEN** the previous successfully committed run selected model `A` and the user sends the next message with model `B`
- **THEN** model `B` receives model `B`'s effective top-level system prompt and tool declarations
- **AND** portable earlier conversation turns remain in history
- **AND** model `A`'s system prompt is not replayed

#### Scenario: Earlier turn contains reasoning and tool activity

- **WHEN** an earlier assistant turn persisted reasoning, provider-native metadata, or settled tool activity/results alongside visible answer text
- **AND** a later turn uses the same model or switches providers or models
- **THEN** the later model receives the visible answer text through the canonical replay projection
- **AND** it receives the earlier tool observations in the target provider's expected representation, each call accompanied by its result
- **AND** the persisted reasoning parts and their provider metadata are passed back unchanged under `reasoning-output`, with no coercion, pruning, or re-binding for the later model

#### Scenario: Target context window cannot fit portable history

- **WHEN** a turn switches from model `A` to smaller-context model `B` and the complete request for `B` would exceed its configured context window or reserved output budget
- **AND** model `A` plus its most recent system-prompt receipt remain executable
- **THEN** the worker performs transition compaction with model `A` over history through the last assistant turn before invoking model `B`
- **AND** the triggering user message remains outside the summarized prefix
- **AND** model `B` receives its own prompt and tools, the resulting portable checkpoint, retained recent history, and the switch reminder plus triggering user text

#### Scenario: No capable source model is available

- **WHEN** the target request does not fit and the prior model or its successful system-prompt receipt is unavailable or transition compaction fails
- **THEN** the run fails before the target provider call with `context_incompatible`
- **AND** history is not silently truncated and no fallback model is selected

#### Scenario: Over-window public-chat fork has no source execution context

- **WHEN** the owner of a public-chat fork sends a turn whose portable fork history does not fit the selected model
- **AND** no source-model system-prompt receipt owned by the fork owner can compact that history in one request
- **THEN** the run fails with `context_incompatible`
- **AND** the system does not access the source owner's snapshots, prompt receipts, credentials, or non-public metadata

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

Failed-attempt visible output and tool observations SHALL remain part of the committed record and participate in later model context and compaction exactly as a successful turn's do, through the canonical replay projection, with their reasoning parts replayed under `reasoning-output`; only attempt-generated rail context stays staged and publishes with a successful turn. Transition compaction SHALL use no persisted tool declarations and SHALL follow the source system-receipt contract below.
