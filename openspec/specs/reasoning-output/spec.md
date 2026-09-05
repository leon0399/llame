# reasoning-output

## Purpose

Capture provider-authorized displayable model reasoning as durable, private, ordered assistant output without changing model-catalog reasoning semantics. Headed summary parts render as distinct markdown blocks; consecutive summaries share one Thinking panel, and a tool or visible text part splits panels.

## Requirements

### Requirement: Normalized reasoning is collected without changing catalog semantics

The system SHALL collect displayable reasoning when the selected AI SDK model adapter emits normalized reasoning output. Reasoning collection SHALL remain independent of catalog configuration: a model that emits normalized reasoning chunks SHALL have them collected and persisted whether or not its catalog entry declares a `reasoning` object, and whether or not the run carries an effort.

The catalog's `reasoning` object declares the model's effort request vocabulary. It SHALL NOT act as a gate on collecting, persisting, or displaying reasoning output.

#### Scenario: Existing catalog metadata remains non-executing

- **WHEN** a model catalog entry declares a `reasoning` object or omits one
- **THEN** that declaration alone does not add, remove, or alter what reasoning output is collected and persisted
- **AND** it gates only which effort values a request may carry, never the reasoning stream

#### Scenario: Existing generic adapter emits normalized reasoning

- **WHEN** an existing selected model adapter emits normalized reasoning chunks
- **THEN** llame collects and persists those chunks regardless of the catalog declaration

#### Scenario: Reasoning is collected regardless of the run's effort

- **WHEN** a run executes at any effort, including one that denotes disabled reasoning
- **THEN** whatever normalized reasoning the adapter emits is collected and persisted unchanged
- **AND** an empty reasoning stream remains a successful run

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

The backend SHALL use the existing AI SDK reasoning stream protocol and persisted reasoning part shape. The web chat SHALL render those parts in persisted order. Consecutive reasoning parts with no intervening tool or visible text SHALL share one Thinking panel. A tool or visible text part SHALL split panels so occurrence order is preserved.

#### Scenario: Existing renderer receives historical reasoning

- **WHEN** a user reloads a chat containing a persisted reasoning part
- **THEN** the existing client receives that part in its persisted order

#### Scenario: Consecutive summary parts share one Thinking panel

- **WHEN** a run emits two reasoning-summary parts, then a tool call, then another reasoning-summary part
- **THEN** the chat shows one Thinking panel for the first two summaries, the tool, then a second Thinking panel
- **AND** it does not hoist every reasoning part above the tool

### Requirement: Reasoning summaries render as distinct markdown blocks

Displayable reasoning from providers that emit headed summary parts (OpenAI Responses `reasoningSummary`, and equivalent Anthropic/relay shapes) SHALL render each part as its own markdown block. When the AI SDK supplies a reasoning part id (`${itemId}:${summaryIndex}` on OpenAI Responses), each distinct id SHALL persist as its own `{ type: "reasoning" }` part. Consecutive persisted reasoning parts still share one Thinking panel. Concatenated parts that glue a heading onto the previous part (`**One****Two**`, or prose butting onto `**Heading**`) SHALL be separated by a paragraph break at display and export, including for reasoning persisted before part ids were recorded and for Chat Completions relays that never emit an id. Isolated bold titles SHALL read as section headings against the muted body.

#### Scenario: Responses summary_index persists as separate parts

- **WHEN** a native Responses stream emits reasoning deltas whose SDK part id changes
- **THEN** the assistant message stores one reasoning part per id
- **AND** the chat still shows those parts in one Thinking panel until a tool or visible text splits the group

#### Scenario: Glued summary headings split before render

- **WHEN** persisted or live reasoning text contains `**Investigating****Inspecting schema**`
- **THEN** the Thinking panel renders two bold titles, not one half-bold `****` run

#### Scenario: Token-streamed reasoning is not split on mid-sentence emphasis

- **WHEN** reasoning text contains a bold word after whitespace (`the **signature** field`)
- **THEN** that emphasis stays inline and no paragraph break is inserted
