## MODIFIED Requirements

### Requirement: Third-party compatibility remains best-effort

OpenRouter, Hugging Face, and other third-party OpenAI-compatible endpoints SHALL execute on the wire their provider `type` selects, which normalizes reasoning only where the selected adapter emits it. This change SHALL NOT add vendor-specific reasoning request fields, raw SSE parsers, tag extraction, or middleware for them. Reasoning is collected only when the selected adapter already emits normalized reasoning output.

#### Scenario: Third-party endpoint emits unsupported raw reasoning data

- **WHEN** a third-party compatible endpoint returns reasoning in a response shape not normalized by the selected adapter
- **THEN** llame does not synthesize a reasoning part from that data in this change

### Requirement: Existing UI support receives durable reasoning parts

The backend SHALL use the existing AI SDK reasoning stream protocol and persisted reasoning part shape, extended only by the optional opaque provider metadata this capability defines. The web chat SHALL render reasoning parts in persisted order. Consecutive reasoning parts with no intervening tool or visible text part SHALL share one Thinking panel. A tool or visible text part SHALL split panels so occurrence order is preserved.

#### Scenario: Existing renderer receives historical reasoning

- **WHEN** a user reloads a chat containing a persisted reasoning part
- **THEN** the existing client receives that part in its persisted order

#### Scenario: Consecutive summary parts share one Thinking panel

- **WHEN** a run emits two reasoning-summary parts, then a tool call, then another reasoning-summary part
- **THEN** the chat shows one Thinking panel for the first two summaries, the tool, then a second Thinking panel
- **AND** it does not hoist every reasoning part above the tool

### Requirement: Reasoning is an ordered private assistant part

Displayable reasoning SHALL persist as display-only `{ type: "reasoning", text }` assistant parts, each optionally carrying opaque provider metadata, in the exact occurrence order in which it appeared relative to text and tool parts. The same order SHALL be reconstructed by live streaming, reconnect replay, and historical chat loading. Persisted reasoning text SHALL be the text the provider produced, unmodified and untruncated, and SHALL be retained with the chat until normal deletion. Reasoning parts SHALL be excluded from chat search and public shares, and from the history a compaction request summarizes. Replay is a property of the request kind, not of the projection: when a request is built to continue a Chat, that Chat's stored reasoning parts SHALL be offered to the provider in their occurrence position, each with its text and any provider metadata byte-identical to what was persisted; the selected adapter carries every part its wire can represent (Chat Completions: the text as `reasoning_content`; Responses: parts that carry an item id or encrypted content) and omits the rest without failing the request. An assistant message whose only parts are reasoning SHALL still enter model context. The metadata SHALL stay opaque and SHALL NOT be rendered, exported, indexed, or published. This narrows exactly one exclusion — reuse by the Chat's own provider requests — and leaves the parts' privacy posture unchanged everywhere else.

#### Scenario: Interleaved output survives reload faithfully

- **WHEN** a run emits reasoning, visible text, a tool activity part, more reasoning, and more visible text in that order
- **THEN** the persisted assistant message and a reloaded chat retain that exact part order

#### Scenario: Reasoning stays private and display-only

- **WHEN** a compaction summary is built, search indexes a chat, or a chat is viewed through a public share
- **THEN** no reasoning-part text or provider metadata is included in that summary, index, or public payload

#### Scenario: Compaction and continuation share one projection

- **WHEN** a compaction request and a continuation request are built from the same stored messages
- **THEN** the continuation carries their reasoning parts and the compaction request carries none
- **AND** the difference is a declared property of the request, not an incidental effect of caller order

#### Scenario: Long reasoning is persisted whole

- **WHEN** a turn emits more reasoning than any earlier persistence cap allowed
- **THEN** every reasoning part is persisted in full, with no truncation marker

#### Scenario: Chat Completions replay carries earlier turns' reasoning

- **WHEN** a later request for the same Chat is built for an `openai-completions` provider after an earlier assistant turn persisted reasoning
- **THEN** that turn's reasoning text is sent back as the assistant message's `reasoning_content`
- **AND** a backend that requires it with `tools` present (DeepSeek) accepts the request

#### Scenario: Responses replay skips parts its wire cannot carry

- **WHEN** a later request for the same Chat is built for an `openai-responses` provider and a persisted reasoning part carries neither an item id nor encrypted content
- **THEN** that part is omitted from the request
- **AND** the request succeeds and parts that do carry them are replayed

#### Scenario: A copied Chat replays the parts it stores

- **WHEN** a Chat that copied another Chat's messages verbatim continues
- **THEN** its own stored reasoning parts and their metadata are replayed, so its model-facing prefix matches the Chat it was copied from
- **AND** a provider that no longer accepts a copied item fails or ignores it under the existing failure contract, without llame rewriting or stripping it

### Requirement: Opaque continuation state is transient and private

Chat history SHALL persist provider-authorized displayable reasoning text together with any opaque provider metadata bound to a persisted reasoning part. Opaque continuation state that is not bound to a persisted reasoning part SHALL remain private run state: it SHALL NOT be rendered or used as later chat context, and SHALL be deleted when the run completes. Provider metadata bound to a persisted reasoning part is durable with that part, is replayed only when a request continues the Chat that stores it, and SHALL NOT be rendered, exported, indexed, or included in a public share.

#### Scenario: Completed run removes opaque continuation state

- **WHEN** an active run uses private opaque continuation state that is not bound to a persisted reasoning part and reaches a terminal status
- **THEN** that state is not retained in the chat transcript
- **AND** the only opaque state retained in message history is provider metadata bound to a persisted reasoning part

## ADDED Requirements

### Requirement: Reasoning follows the selected adapter on every wire

Reasoning content that the selected adapter normalizes SHALL be surfaced as the existing normalized reasoning output on every wire, and reasoning the adapter produced for a turn SHALL be returned on that turn's own follow-up requests. The system SHALL NOT add vendor-specific reasoning request fields, raw SSE parsing, tag extraction, or middleware to obtain it. A response that carries no reasoning SHALL remain a successful response.

#### Scenario: Chat Completions backend reasoning is displayed

- **WHEN** an `openai-completions` endpoint emits `reasoning_content` the adapter normalizes
- **THEN** the run collects and persists it under this capability's contract
- **AND** no llame-authored parser is involved

#### Scenario: The turn's follow-up request carries prior reasoning

- **WHEN** a turn's follow-up request follows a response that carried reasoning
- **THEN** the reasoning the adapter produced for that turn is sent back to the endpoint

#### Scenario: No reasoning output is not a failure

- **WHEN** a response contains no displayable reasoning
- **THEN** the run completes normally

### Requirement: Reasoning part identity follows the adapter's part id

A new persisted reasoning part SHALL start when the last collected part is not a reasoning part, or when the adapter-supplied part id of the incoming delta and the open reasoning part's id are both defined and differ. Otherwise the delta SHALL append to the open reasoning part, and a defined incoming id SHALL become the open part's id. The system SHALL NOT invent a part boundary for a transition no adapter emits, and live streaming, reconnect replay, and historical chat loading SHALL reconstruct the same parts.

#### Scenario: Responses summary parts persist separately

- **WHEN** a Responses stream emits reasoning deltas whose adapter-supplied id changes (`${itemId}:${summaryIndex}`)
- **THEN** the assistant message stores one reasoning part per id, in order
- **AND** live output, reconnect replay, and a reloaded chat show the same parts

#### Scenario: A constant adapter id keeps uninterrupted reasoning as one part

- **WHEN** a Chat Completions backend emits reasoning deltas that all carry the adapter's constant id (`reasoning-0`) with no intervening text or tool part
- **THEN** the turn's reasoning persists as a single part

#### Scenario: An intervening part splits reasoning under a constant id

- **WHEN** a backend emits reasoning, then a tool call, then more reasoning, all under the same adapter id
- **THEN** two reasoning parts persist with the tool part between them
- **AND** neither is hoisted above the tool

#### Scenario: An absent id is not a boundary

- **WHEN** a reasoning delta without an adapter-supplied id follows an open reasoning part, or a delta with an id follows an open part that has none
- **THEN** the delta appends to the open part
- **AND** live output and replayed history agree

### Requirement: Reasoning parts carry durable provider metadata

An assistant reasoning part MAY carry opaque provider metadata supplied by the adapter that produced it (for the Responses wire: the reasoning item id on every part of an item, and the item's encrypted content on whichever part the adapter attaches it to, read from the adapter's reasoning start and end stream parts). That metadata SHALL persist with the part in the chat's message parts, SHALL be replayed to the provider on later requests that continue the same Chat together with the part's unmodified text, and SHALL stay opaque: never rendered, exported, indexed, included in a public share, or written to logs, telemetry, or errors. Its presence SHALL NOT change the part's display text, its order relative to other parts, or the treatment of reasoning text elsewhere in the system.

#### Scenario: Provider metadata persists with the reasoning part

- **WHEN** an adapter supplies metadata for a reasoning part
- **THEN** the metadata is persisted with that part and survives a reload of the chat

#### Scenario: Provider metadata is replayed for the same Chat

- **WHEN** a later request continues the same Chat
- **THEN** the provider metadata accompanies its reasoning part to the provider as that wire's reasoning input
- **AND** parts sharing one reasoning item are replayed as that item, whichever part carried its encrypted content

#### Scenario: A resumed Run continues with its reasoning intact

- **WHEN** a worker restarts between a tool call and its continuation and the resumed Run rebuilds the request from persisted parts
- **THEN** the continuation carries the earlier reasoning part with its metadata and unmodified text

#### Scenario: Provider metadata is never rendered or published

- **WHEN** a chat is displayed, exported as markdown, indexed for search, or viewed through a public share
- **THEN** no provider metadata appears in that output

#### Scenario: Provider metadata never reaches a diagnostic sink

- **WHEN** a request carrying replayed provider metadata fails, or the run writes logs or telemetry for it
- **THEN** the metadata value appears in no log line, telemetry field, or error

#### Scenario: A reasoning part without metadata is unchanged

- **WHEN** a reasoning part carries no provider metadata
- **THEN** its persisted shape, display, and ordering are exactly as before

### Requirement: Reasoning summaries render as distinct markdown blocks

When reasoning text is rendered in the Thinking panel or exported as markdown, a heading glued onto the text before it — a `****` run with non-whitespace on both sides, or prose butting directly onto a `**Heading**` whose closing `**` is followed by a newline or end of text — SHALL be separated by a paragraph break, so each headed summary reads as its own block. Markdown export SHALL separate consecutive reasoning parts with a blank line. This SHALL apply to reasoning persisted before per-part identity was recorded. Emphasis that occurs mid-sentence after whitespace or punctuation SHALL be left inline. The repair SHALL NOT modify persisted reasoning text.

#### Scenario: Glued summary headings split at render

- **WHEN** persisted reasoning text contains `**Investigating****Inspecting schema**`
- **THEN** the Thinking panel and the markdown export show two bold titles, not one half-bold `****` run
- **AND** the persisted text is unchanged

#### Scenario: Glued headings split for history persisted before part ids

- **WHEN** a chat whose reasoning was persisted before per-part identity was recorded is rendered or exported and its reasoning glues a heading onto the preceding text
- **THEN** a paragraph break separates the heading from that text in the rendered and exported output

#### Scenario: Inline emphasis is not split

- **WHEN** reasoning text contains a bold span after whitespace or punctuation (`the **signature** field`, `Check (**signature**) next`), or a bold span followed by more prose on the same line
- **THEN** that emphasis stays inline and no paragraph break is inserted

#### Scenario: Consecutive reasoning parts export as separate blocks

- **WHEN** an assistant message holds two consecutive reasoning parts, each beginning with a `**Heading**`
- **THEN** the markdown export places a blank line between them
- **AND** each heading renders as its own block

### Requirement: Chat Completions reasoning is evidence-gated

Reasoning support on the `openai-completions` wire SHALL be accepted only after a bounded live smoke proves that wire's request shape, its normalized stream output, and that a later request within the same turn carries the reasoning the adapter produced back to the endpoint. The smoke SHALL run against a directly-billed reasoning-capable Chat Completions endpoint. A response with no displayable reasoning SHALL remain a successful response.

#### Scenario: Completions probe observes a reasoning span

- **WHEN** the bounded live smoke receives a displayable reasoning span from the endpoint
- **THEN** it verifies durable event persistence, ordered historical projection, and reconnect replay for that span before the reasoning path is accepted

#### Scenario: Completions probe verifies the within-turn outbound half

- **WHEN** the smoke continues the turn after receiving that span
- **THEN** the follow-up request carries the reasoning the adapter produced back to the endpoint

#### Scenario: A zero-reasoning response is not a failure

- **WHEN** the endpoint returns no displayable reasoning
- **THEN** the smoke records a successful response
- **AND** no unproven behavior is inferred from it
