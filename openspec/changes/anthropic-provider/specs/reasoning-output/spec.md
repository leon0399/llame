## MODIFIED Requirements

### Requirement: Reasoning part identity follows the adapter's part id

A new persisted reasoning part SHALL start when the last collected part is not a reasoning part, or when the adapter-supplied part id of the incoming delta and the open reasoning part's id are both defined and differ. Otherwise the delta SHALL append to the open reasoning part, and a defined incoming id SHALL become the open part's id. A delivery whose text is empty but which carries provider metadata under an adapter-supplied id that no collected part carries SHALL start a reasoning part with empty text and bind the metadata to it, because a provider that withholds thinking text still returns a block whose metadata a later request must replay; an empty delivery without metadata, or whose id names a collected part, starts no part and moves no boundary. The system SHALL NOT invent a part boundary for a transition no adapter emits, and live streaming, reconnect replay, and historical chat loading SHALL reconstruct the same parts.

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

#### Scenario: A metadata-only delivery under a new id starts an empty part

- **WHEN** an adapter delivers a reasoning part id that no collected part carries, with empty text and provider metadata (a thinking block whose text the provider withheld)
- **THEN** a reasoning part with empty text and that metadata is persisted in occurrence order
- **AND** an empty delivery whose id names an already collected part still binds its metadata to that part without starting another

### Requirement: Existing UI support receives durable reasoning parts

The backend SHALL use the existing AI SDK reasoning stream protocol and persisted reasoning part shape, extended only by the optional opaque provider metadata this capability defines. The web chat SHALL render reasoning parts in persisted order. Consecutive reasoning parts with no intervening tool or visible text part SHALL share one Thinking panel. A tool or visible text part SHALL split panels so occurrence order is preserved. A panel whose grouped parts carry no reasoning text SHALL NOT be rendered: a provider that withholds thinking text still returns thinking blocks whose text is empty and whose metadata is needed for replay, so such parts persist and replay exactly as any other reasoning part while the chat shows nothing for them.

#### Scenario: Existing renderer receives historical reasoning

- **WHEN** a user reloads a chat containing a persisted reasoning part
- **THEN** the existing client receives that part in its persisted order

#### Scenario: Consecutive summary parts share one Thinking panel

- **WHEN** a run emits two reasoning-summary parts, then a tool call, then another reasoning-summary part
- **THEN** the chat shows one Thinking panel for the first two summaries, the tool, then a second Thinking panel
- **AND** it does not hoist every reasoning part above the tool

#### Scenario: An empty reasoning segment renders no panel

- **WHEN** an assistant message holds consecutive reasoning parts whose text is empty, for example signed thinking blocks returned with their text withheld
- **THEN** the chat renders no Thinking panel for that segment
- **AND** the parts persist with their provider metadata and are replayed to the provider unchanged
