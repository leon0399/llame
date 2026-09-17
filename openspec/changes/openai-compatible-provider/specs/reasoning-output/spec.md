## MODIFIED Requirements

### Requirement: Third-party compatibility remains best-effort

OpenRouter, Hugging Face, and other third-party OpenAI-compatible endpoints SHALL execute on the path their provider `type` selects, which normalizes reasoning only where the selected adapter emits it. This change SHALL NOT add vendor-specific reasoning request fields, raw SSE parsers, tag extraction, or middleware for them. Reasoning is collected only when the existing adapter already emits normalized reasoning output.

#### Scenario: Third-party endpoint emits unsupported raw reasoning data

- **WHEN** a third-party compatible endpoint returns reasoning in a response shape not normalized by the existing adapter
- **THEN** llame does not synthesize a reasoning part from that data in this change

### Requirement: Existing UI support receives durable reasoning parts

The backend SHALL use the existing AI SDK reasoning stream protocol and persisted reasoning part shape. The web chat SHALL render those parts in persisted order. Consecutive reasoning parts with no intervening tool or visible text SHALL share one Thinking panel. A tool or visible text part SHALL split panels so occurrence order is preserved.

#### Scenario: Existing renderer receives historical reasoning

- **WHEN** a user reloads a chat containing a persisted reasoning part
- **THEN** the existing client receives that part in its persisted order

#### Scenario: Consecutive summary parts share one Thinking panel

- **WHEN** a run emits two reasoning-summary parts, then a tool call, then another reasoning-summary part
- **THEN** the chat shows one Thinking panel for the first two summaries, the tool, then a second Thinking panel
- **AND** it does not hoist every reasoning part above the tool

### Requirement: Reasoning is an ordered private assistant part

Displayable reasoning SHALL persist as display-only `{ type: "reasoning", text }` assistant parts in the exact occurrence order in which it appeared relative to text and tool parts. The same order SHALL be reconstructed by live streaming, reconnect replay, and historical chat loading. It SHALL be retained with the chat until normal deletion. Reasoning parts SHALL be excluded from compaction input, chat search, and public shares. When model context is built for the same Chat, its reasoning parts and any provider metadata they carry SHALL be returned to the provider; the metadata SHALL stay opaque and SHALL NOT be rendered, exported, indexed, or published. This narrows exactly one exclusion — reuse by the Chat's own provider requests — and leaves the parts' privacy posture unchanged everywhere else.

#### Scenario: Interleaved output survives reload faithfully

- **WHEN** a run emits reasoning, visible text, a tool activity part, more reasoning, and more visible text in that order
- **THEN** the persisted assistant message and a reloaded chat retain that exact part order

#### Scenario: Reasoning stays private and display-only

- **WHEN** a compaction summary is built, search indexes a chat, or a chat is viewed through a public share
- **THEN** no reasoning-part text or provider metadata is included in that summary, index, or public payload

### Requirement: Opaque continuation state is transient and private

Chat history SHALL persist provider-authorized displayable reasoning text together with any opaque provider metadata bound to a persisted reasoning part. Opaque continuation state that is not bound to a persisted reasoning part SHALL remain private run state: it SHALL NOT be rendered or used as later chat context, and SHALL be deleted when the run completes. Provider metadata bound to a persisted reasoning part is durable with that part, is replayed only for the same Chat, and SHALL NOT be rendered, exported, indexed, or included in a public share.

#### Scenario: Completed run removes opaque continuation state

- **WHEN** an active run uses private opaque continuation state that is not bound to a persisted reasoning part and reaches a terminal status
- **THEN** that state is not retained in the chat transcript
- **AND** the only opaque state retained in message history is provider metadata bound to a persisted reasoning part

## ADDED Requirements

### Requirement: Reasoning part identity follows the adapter's part id

When the selected adapter supplies an identity for a reasoning span, each distinct identity SHALL persist as its own display-only `{ type: "reasoning" }` part, in the order the identities appeared. When the adapter supplies no identity, the turn's reasoning SHALL persist as a single concatenated part. The system SHALL NOT invent a part boundary for a transition no adapter emits, and live streaming, reconnect replay, and historical chat loading SHALL reconstruct the same parts.

#### Scenario: Responses summary parts persist separately

- **WHEN** a Responses stream emits reasoning deltas whose adapter-supplied identity changes
- **THEN** the assistant message stores one reasoning part per identity, in order
- **AND** live output, reconnect replay, and a reloaded chat show the same parts

#### Scenario: An adapter without reasoning identity persists one part

- **WHEN** a backend emits reasoning deltas that carry no adapter-supplied identity (Chat Completions and OpenAI-compatible backends today)
- **THEN** the turn's reasoning persists as a single concatenated part

### Requirement: Reasoning parts carry durable provider metadata

An assistant reasoning part MAY carry opaque provider metadata supplied by the provider path that produced it. That metadata SHALL persist with the part in the chat's message parts, SHALL be replayed to the provider on later requests for the same Chat, and SHALL stay opaque: never rendered, exported, indexed, or included in a public share. Its presence SHALL NOT change the part's display text, its order relative to other parts, or the treatment of reasoning text elsewhere in the system.

#### Scenario: Provider metadata persists with the reasoning part

- **WHEN** a provider path supplies metadata for a reasoning part
- **THEN** the metadata is persisted with that part and survives a reload of the chat

#### Scenario: Provider metadata is replayed for the same Chat

- **WHEN** a later request builds model context for the same Chat
- **THEN** the provider metadata accompanies its reasoning part to the provider

#### Scenario: Provider metadata is never rendered or published

- **WHEN** a chat is displayed, exported as markdown, indexed for search, or viewed through a public share
- **THEN** no provider metadata appears in that output

#### Scenario: A reasoning part without metadata is unchanged

- **WHEN** a reasoning part carries no provider metadata
- **THEN** its persisted shape, display, and ordering are exactly as before

### Requirement: Reasoning summaries render as distinct markdown blocks

Reasoning text whose heading is glued to the text before it (`**One****Two**`, or prose butting directly onto a `**Heading**`) SHALL be separated by a paragraph break wherever reasoning is persisted, rendered, or exported as markdown, so each headed summary renders as its own markdown block. This SHALL apply to reasoning persisted before per-part identity was recorded. Emphasis that occurs mid-sentence after whitespace SHALL be left inline.

#### Scenario: Glued summary headings split before render

- **WHEN** reasoning text contains `**Investigating****Inspecting schema**`
- **THEN** the Thinking panel renders two bold titles, not one half-bold `****` run

#### Scenario: Glued headings split for history persisted before part ids

- **WHEN** a chat whose reasoning was persisted before per-part identity was recorded is rendered or exported as markdown and its reasoning glues a heading onto the preceding text
- **THEN** a paragraph break separates the heading from that text

#### Scenario: Token-streamed reasoning is not split on mid-sentence emphasis

- **WHEN** reasoning text contains a bold word after whitespace (`the **signature** field`)
- **THEN** that emphasis stays inline and no paragraph break is inserted

### Requirement: Persisted reasoning is bounded across the turn

The bound on persisted reasoning SHALL apply to a turn's reasoning as a whole rather than to each reasoning part independently, so a turn that emits many parts cannot persist a multiple of the bound. Reasoning within the bound SHALL be persisted in full.

#### Scenario: Many reasoning parts share one bound

- **WHEN** a turn emits more reasoning than the bound, spread across several parts
- **THEN** the total persisted reasoning for that turn does not exceed the bound

#### Scenario: Reasoning within the bound is persisted in full

- **WHEN** a turn's reasoning is within the bound
- **THEN** every part is persisted without truncation

### Requirement: OpenAI-compatible reasoning is evidence-gated

Reasoning support on the OpenAI-compatible surface SHALL be accepted only after a bounded live smoke proves that surface's request shape, its normalized stream output, and that a later request within the same turn carries the reasoning the adapter produced back to the endpoint. The smoke SHALL run against a directly-billed reasoning-capable OpenAI-compatible endpoint. A response with no displayable reasoning SHALL remain a successful response.

#### Scenario: Compatible probe observes a reasoning span

- **WHEN** the bounded live smoke receives a displayable reasoning span from the compatible endpoint
- **THEN** it verifies durable event persistence, ordered historical projection, and reconnect replay for that span before the reasoning path is accepted

#### Scenario: Compatible probe verifies the within-turn outbound half

- **WHEN** the smoke continues the turn after receiving that span
- **THEN** the follow-up request carries the reasoning the adapter produced back to the endpoint

#### Scenario: A zero-reasoning response is not a failure

- **WHEN** the compatible endpoint returns no displayable reasoning
- **THEN** the smoke records a successful response
- **AND** no unproven behavior is inferred from it
