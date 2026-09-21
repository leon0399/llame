## MODIFIED Requirements

### Requirement: Reasoning part identity follows the adapter's part id

A new persisted reasoning part SHALL start when the last collected part is not a reasoning part, or when the adapter-supplied part id of the incoming delta and the open reasoning part's id are both defined and differ. Otherwise the delta SHALL append to the open reasoning part, and a defined incoming id SHALL become the open part's id. A delivery whose text is empty but which carries provider metadata under a defined adapter-supplied id that no collected part carries SHALL start a reasoning part with empty text and bind the metadata to it, because a provider that withholds thinking text or summary text still returns a block whose metadata a later request must replay; an empty delivery without metadata, one whose id names a collected part, or one without an id (which binds to the open part, as before) starts no part and moves no boundary. Because that rule binds metadata by id, every distinct metadata-bearing provider part SHALL have an id unique within the turn, while repeated deliveries for the same part MAY reuse its id. A client whose adapter numbers metadata-bearing parts per provider response SHALL scope those ids to the provider invocation; an adapter that emits no provider metadata MAY reuse a constant id across parts and rely on an emitted non-reasoning boundary to split them as specified below. A client SHALL deliver every reasoning part — text and metadata-only — in stream order from one consumer, so a metadata-only delivery can never start a part ahead of the text that precedes it, and a delivery that starts a part SHALL be recorded behind any buffered text that precedes it in the durable log. The system SHALL NOT invent a part boundary for a transition no adapter emits, and live streaming, reconnect replay, and historical chat loading SHALL reconstruct the same parts, except that a part started by a metadata-only delivery produces no live or reconnect chunk: it carries no text, the metadata never reaches the browser, and a text-less segment renders no panel, so the rendered parts agree.

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

- **WHEN** an adapter delivers a defined reasoning part id that no collected part carries, with empty text and provider metadata (a thinking block whose text the provider withheld, or a Responses reasoning item whose summary is empty)
- **THEN** a reasoning part with empty text and that metadata is persisted in occurrence order, behind any text that preceded it
- **AND** an empty delivery whose id names an already collected part still binds its metadata to that part without starting another
- **AND** the live stream and reconnect replay emit no chunk for the part, and the reloaded chat renders no panel for it

#### Scenario: Per-response part ids do not collide across steps

- **WHEN** a provider numbers reasoning blocks from zero in every response and a tool turn produces a withheld-text block in two consecutive steps
- **THEN** two reasoning parts persist, each with its own metadata, in step order
- **AND** neither block's metadata overwrites the other's

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
