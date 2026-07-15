## ADDED Requirements

### Requirement: Normalized reasoning is collected without changing catalog semantics

The system SHALL collect displayable reasoning when the selected AI SDK model adapter emits normalized reasoning output. The existing `models[].reasoning` catalog field SHALL remain metadata-only; this change SHALL NOT make it a runtime request gate or add a reasoning configuration schema.

#### Scenario: Existing catalog metadata remains non-executing

- **WHEN** a model catalog entry has `reasoning: true` or omits that field
- **THEN** that field alone does not add, remove, or alter a provider request in this change

#### Scenario: Existing generic adapter emits normalized reasoning

- **WHEN** an existing selected model adapter emits normalized reasoning chunks
- **THEN** llame collects and persists those chunks regardless of the catalog field

### Requirement: Native OpenAI behavior is evidence-gated

The implementation SHALL add a native OpenAI reasoning request path only after a bounded live smoke proves its request shape and normalized stream output. The smoke SHALL first use configured `gpt-5.4-mini` with deliberately hard prompts and MAY use configured `gpt-5.5` when the first model is inconclusive. A zero-reasoning response SHALL remain a successful response.

#### Scenario: Native OpenAI probe observes a reasoning span

- **WHEN** the bounded live smoke receives a displayable native OpenAI reasoning span
- **THEN** it verifies durable event persistence, ordered historical projection, and reconnect replay for that span before implementation is accepted

#### Scenario: Native OpenAI probe is inconclusive

- **WHEN** configured `gpt-5.4-mini` produces no reasoning span for the bounded hard-prompt probe
- **THEN** the smoke may use configured `gpt-5.5`
- **AND** no unproven adapter behavior is inferred from a zero-reasoning response

### Requirement: Third-party compatibility remains best-effort

OpenRouter, Hugging Face, and other third-party OpenAI-compatible endpoints SHALL remain on their existing execution path. This change SHALL NOT add vendor-specific reasoning request fields, raw SSE parsers, tag extraction, or middleware for them. Reasoning is collected only when the existing adapter already emits normalized reasoning output.

#### Scenario: Third-party endpoint emits unsupported raw reasoning data

- **WHEN** a third-party compatible endpoint returns reasoning in a response shape not normalized by the existing adapter
- **THEN** llame does not synthesize a reasoning part from that data in this change

### Requirement: Reasoning is an ordered private assistant part

Displayable reasoning SHALL persist as display-only `{ type: "reasoning", text }` assistant parts in the exact occurrence order in which it appeared relative to text and tool parts. The same order SHALL be reconstructed by live streaming, reconnect replay, and historical chat loading. It SHALL be retained with the chat until normal deletion. Reasoning parts SHALL be excluded from later model context, compaction input, chat search, and public shares.

#### Scenario: Interleaved output survives reload faithfully

- **WHEN** a run emits reasoning, visible text, a tool activity part, more reasoning, and more visible text in that order
- **THEN** the persisted assistant message and a reloaded chat retain that exact part order

#### Scenario: Reasoning stays private and display-only

- **WHEN** a later run builds model context, search indexes a chat, or a chat is viewed through a public share
- **THEN** no reasoning-part text is included in that context, index, or public payload

### Requirement: Opaque continuation state is transient and private

The system SHALL persist only provider-authorized displayable reasoning text in chat history. If a proven native provider path requires opaque continuation state to complete an active durable run, that state SHALL remain private run state, SHALL NOT be rendered or used as later chat context, and SHALL be deleted when the run completes.

#### Scenario: Completed run removes opaque continuation state

- **WHEN** an active run uses private opaque continuation state and reaches a terminal status
- **THEN** the state is not retained in the chat transcript
- **AND** only displayable reasoning text remains in message history

### Requirement: Existing UI support receives durable reasoning parts

The backend SHALL use the existing AI SDK reasoning stream protocol and persisted reasoning part shape. This change SHALL NOT modify frontend rendering behavior.

#### Scenario: Existing renderer receives historical reasoning

- **WHEN** a user reloads a chat containing a persisted reasoning part
- **THEN** the existing client receives that part in its persisted order without frontend changes
