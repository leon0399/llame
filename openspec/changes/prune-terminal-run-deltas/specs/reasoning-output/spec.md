## MODIFIED Requirements

### Requirement: Reasoning part identity follows the adapter's part id

A new persisted reasoning part SHALL start when the last collected part is not a reasoning part, or when the adapter-supplied part id of the incoming delta and the open reasoning part's id are both defined and differ. Otherwise the delta SHALL append to the open reasoning part, and a defined incoming id SHALL become the open part's id. A delivery whose text is empty but which carries provider metadata under a defined adapter-supplied id that no collected part carries SHALL start a reasoning part with empty text and bind the metadata to it, because a provider that withholds thinking text or summary text still returns a block whose metadata a later request must replay; an empty delivery without metadata, one whose id names a collected part, or one without an id (which binds to the open part, as before) starts no part and moves no boundary. Because that rule binds metadata by id, every distinct metadata-bearing provider part SHALL have an id unique within the turn, while repeated deliveries for the same part MAY reuse its id. A client whose adapter numbers metadata-bearing parts per provider response SHALL scope those ids to the provider invocation; an adapter that emits no provider metadata MAY reuse a constant id across parts and rely on an emitted non-reasoning boundary to split them as specified below. A client SHALL deliver every reasoning part — text and metadata-only — in stream order from one consumer, so a metadata-only delivery can never start a part ahead of the text that precedes it, and a delivery that starts a part SHALL be recorded behind any buffered text that precedes it in the durable log. The system SHALL NOT invent a part boundary for a transition no adapter emits, and live streaming, reconnect replay while the attempt's delta events are retained, and historical chat loading SHALL reconstruct the same parts, except that a part started by a metadata-only delivery produces no live or reconnect chunk: it carries no text, the metadata never reaches the browser, and a text-less segment renders no panel, so the rendered parts agree.

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

### Requirement: Reasoning is an ordered private assistant part

Displayable reasoning SHALL persist as display-only `{ type: "reasoning", text }` assistant parts, each optionally carrying opaque provider metadata, in the exact occurrence order in which it appeared relative to text and tool parts. The same order SHALL be reconstructed by live streaming, by reconnect replay while the attempt's delta events are retained, and by historical chat loading; once `durable-runs` "Delta events of finished Runs are pruned after a retention window" deletes them, the assistant message alone holds that order. Persisted reasoning text SHALL be the text the provider produced, unmodified and untruncated, and SHALL be retained with the chat until normal deletion. Reasoning parts SHALL be excluded from chat search and public shares, and from the history a compaction request summarizes. Replay is a property of the request kind, not of the projection: when a request is built to continue a Chat, that Chat's stored reasoning parts SHALL be offered to the provider in their occurrence position, each with its text and any provider metadata byte-identical to what was persisted; the selected adapter carries every part its wire can represent (Chat Completions: the text as `reasoning_content`; Responses: parts that carry an item id or encrypted content) and omits the rest without failing the request. An assistant message whose only parts are reasoning SHALL still enter model context. The metadata SHALL stay opaque and SHALL NOT be rendered, exported, indexed, or published. This narrows exactly one exclusion — reuse by the Chat's own provider requests — and leaves the parts' privacy posture unchanged everywhere else.

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
