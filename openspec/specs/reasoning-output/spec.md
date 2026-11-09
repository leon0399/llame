# reasoning-output

## Purpose

Capture provider-authorized displayable model reasoning as durable, private, ordered assistant output without changing model-catalog reasoning semantics or frontend rendering.

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

### Requirement: Third-party compatibility remains best-effort

OpenRouter, Hugging Face, and other third-party OpenAI-compatible endpoints SHALL execute on the wire their provider `type` selects, which normalizes reasoning only where the selected adapter emits it. This change SHALL NOT add vendor-specific reasoning request fields, raw SSE parsers, tag extraction, or middleware for them. Reasoning is collected only when the selected adapter already emits normalized reasoning output.

#### Scenario: Third-party endpoint emits unsupported raw reasoning data

- **WHEN** a third-party compatible endpoint returns reasoning in a response shape not normalized by the selected adapter
- **THEN** llame does not synthesize a reasoning part from that data in this change

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

### Requirement: Reasoning is an ordered private assistant part

Displayable reasoning MUST persist as display-only `{ type: "reasoning", text }`
assistant parts, and each part can carry opaque provider metadata. The parts MUST
keep the exact order in which they appeared relative to text and tool parts. The
live stream, reconnect replay, and a historical chat load MUST show the same
order. Persisted reasoning text MUST be the text that the provider produced, with
no change and no truncation. The system MUST keep it with the chat until normal
deletion. Chat search and public shares MUST exclude reasoning parts.

A request that `turn-replay` builds MUST offer each reasoning part that the model
rule of this capability allows to the provider, in its occurrence position. A
compaction request is such a request. The text and the provider metadata of the
part MUST be byte-identical to what was persisted. The selected adapter carries
each part that its wire can represent. On Chat Completions, that is the text as
`reasoning_content`. On Responses, that is each part with encrypted content. The adapter omits the rest and does not fail the request. An assistant
message whose only parts are reasoning MUST still enter model context.

The metadata MUST stay opaque, and the system MUST NOT render, export, index, or
publish it. This narrows one exclusion only: reuse by the provider requests of the
Chat. The privacy of the parts stays the same everywhere else.

#### Scenario: Interleaved output survives reload faithfully

- **WHEN** a run emits reasoning, visible text, a tool activity part, more reasoning, and more visible text in that order
- **THEN** the persisted assistant message and a reloaded chat keep that exact part order

#### Scenario: Reasoning stays private and display-only

- **WHEN** search indexes a chat, a chat is viewed through a public share, or a compaction writes a checkpoint
- **THEN** no reasoning part and no provider metadata is in that index, that public payload, or that checkpoint row

#### Scenario: Compaction and continuation share one projection

- **WHEN** a compaction request and a continuation request are built from the same stored messages for the same model
- **THEN** both requests carry the same reasoning parts
- **AND** the compaction request differs only by its summarization instruction

#### Scenario: Long reasoning is persisted whole

- **WHEN** a turn emits more reasoning than any earlier persistence cap allowed
- **THEN** each reasoning part is persisted in full, with no truncation marker

#### Scenario: Chat Completions replay carries earlier turns' reasoning

- **WHEN** an earlier completed turn persisted reasoning, and a later request goes to the same `openai-completions` model
- **THEN** the reasoning text of that turn goes back as the `reasoning_content` of its assistant message
- **AND** a backend that requires it with `tools` present (DeepSeek) accepts the request

#### Scenario: Responses replay skips parts its wire cannot carry

- **WHEN** a later request goes to an `openai-responses` provider, and a persisted reasoning part carries no encrypted content
- **THEN** the request does not carry that part
- **AND** the request succeeds, and the parts that carry them replay

#### Scenario: A copied Chat replays the parts it stores

- **WHEN** a Chat that copied the messages of another Chat continues on the model that produced them
- **THEN** its own stored reasoning parts and their metadata replay, so its model-facing prefix matches the Chat that it copied
- **AND** a provider that no longer accepts a copied item fails or ignores it under the failure contract
- **AND** llame does not rewrite or remove the item

### Requirement: Opaque continuation state is transient and private

Chat history MUST persist the displayable reasoning text that the provider
authorized, with the opaque provider metadata bound to a persisted reasoning part.
It MUST also persist the provider metadata of text and tool parts that
`turn-replay` defines. Opaque continuation state that is not bound to a persisted
part MUST stay private run state. The system MUST NOT render it or use it as later
chat context, and MUST delete it when the run completes. Persisted provider
metadata is durable with its part. It replays only under the model rule of this
capability. The system MUST NOT render, export, or index it, or put it in a public
share.

#### Scenario: Completed run removes opaque continuation state

- **WHEN** an active run uses private opaque continuation state that is not bound to a persisted part, and the run reaches a terminal status
- **THEN** the chat transcript does not keep that state
- **AND** the only opaque state in message history is provider metadata bound to a persisted reasoning, text, or tool part

### Requirement: Reasoning parts carry durable provider metadata

An assistant reasoning part can carry opaque provider metadata from the adapter
that produced it. On the Responses wire, this is the reasoning item id on each
part of an item. It is also the encrypted content of the item, on the part to
which the adapter attaches it. The adapter reads both from its reasoning start and
end stream parts. That metadata MUST persist with the part in the message parts of
the chat. It MUST replay to the provider with the unchanged text of the part, on
each later request that the model rule of this capability allows. It MUST stay
opaque. The system MUST NOT render, export, or index it, put it in a public share,
or write it to logs, telemetry, or errors. Its presence MUST NOT change the
display text of the part, its order relative to other parts, or the treatment of
reasoning text elsewhere.

#### Scenario: Provider metadata persists with the reasoning part

- **WHEN** an adapter supplies metadata for a reasoning part
- **THEN** the metadata is persisted with that part and stays after a reload of the chat

#### Scenario: Provider metadata is replayed for the same Chat

- **WHEN** a later request of the same Chat runs on the model of the completed reply that holds the part
- **THEN** the provider metadata goes with its reasoning part to the provider as the reasoning input of that wire
- **AND** the parts of one reasoning item replay as that item, whichever part carried its encrypted content

#### Scenario: A resumed Run continues with its reasoning intact

- **WHEN** a worker restarts between a tool call and its continuation, and the owner continues the interrupted Run on its model
- **THEN** the Continue request rebuilds from persisted parts and carries the earlier reasoning part with its metadata and its unchanged text

#### Scenario: A later turn after an interrupted reply omits its reasoning

- **WHEN** a worker restarts between a tool call and its continuation, the interrupted Run settles without completing, and the owner sends a new message
- **THEN** the next request carries no reasoning part and no provider metadata of the interrupted reply
- **AND** it carries that reply's text and tool activity

#### Scenario: Provider metadata is never rendered or published

- **WHEN** a chat is displayed, exported as markdown, indexed for search, or viewed through a public share
- **THEN** no provider metadata appears in that output

#### Scenario: Provider metadata never reaches a diagnostic sink

- **WHEN** a request that carries replayed provider metadata fails, or the run writes logs or telemetry for it
- **THEN** the metadata value appears in no log line, telemetry field, or error

#### Scenario: A reasoning part without metadata is unchanged

- **WHEN** a reasoning part carries no provider metadata
- **THEN** its persisted shape, display, and order stay as before

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

### Requirement: Earlier reasoning replays only for the model that produced it

A reasoning part of an earlier turn MUST replay only when two conditions are
true. Its reply came from a Run with the llame model id of the request. That reply
completed, or an owner interrupt closed it. Otherwise the system MUST omit the part and its provider metadata.
Within one turn, and in the kept parts of a Continue Run, a reasoning part MUST
replay on the model of its Run. The segments of one Run are one turn for this rule,
also before the Run completes. A reasoning part that an interrupt cut MUST NOT
replay in any later request, whatever the status of its reply. In a reply that an
interrupt closed, a reasoning part with no later kept part MUST NOT replay either. The system MUST NOT select reasoning parts by
their content or their age.

#### Scenario: The same model keeps earlier reasoning

- **WHEN** turn 1 completed on the model `sonnet` with a reasoning part, and turn 2 runs on `sonnet`
- **THEN** the first request of turn 2 carries that reasoning part with its provider metadata

#### Scenario: A model switch omits earlier reasoning

- **WHEN** turn 1 completed on `sonnet` with a reasoning part, and turn 2 runs on `glm-5`
- **THEN** the first request of turn 2 carries no reasoning part of turn 1
- **AND** it carries the text and the tool activity of turn 1

#### Scenario: The reasoning of a failed reply is omitted

- **WHEN** the reply of turn 1 failed after a reasoning part, and turn 2 runs on the same model
- **THEN** the first request of turn 2 carries no reasoning part of turn 1
- **AND** it carries the text and the tool activity of turn 1

#### Scenario: Continue keeps the reasoning of a failed Run

- **WHEN** the owner continues a `failed` Run on its model, and a kept step holds a reasoning part
- **THEN** the first request of the Continue Run carries that reasoning part with its provider metadata

#### Scenario: A return to the first model replays its reasoning

- **WHEN** turn 1 completed on `sonnet`, turn 2 completed on `glm-5`, and turn 3 runs on `sonnet`
- **THEN** the first request of turn 3 carries the reasoning parts of turn 1
- **AND** it carries no reasoning part of turn 2

#### Scenario: A later segment keeps the reasoning of an earlier segment

- **WHEN** the first segment of a Run on `sonnet` stored a reasoning part, and a steer starts a second segment
- **THEN** the first request of the second segment carries that reasoning part with its provider metadata

#### Scenario: An interrupted reply keeps only reasoning with a later part

- **WHEN** an interrupt closes a reply with a signed reasoning part, a text part, a second signed reasoning part, and a cut reasoning part
- **THEN** a later request of the same Run carries the first reasoning part and the text part
- **AND** it carries neither the second reasoning part nor the cut part

#### Scenario: A withdrawn interrupt's completed reply keeps the cut part out of later turns

- **WHEN** an interrupt cuts a reasoning part, the owner withdraws the item, and the reply then completes
- **THEN** the next turn on the same model does not carry the cut part

#### Scenario: An interrupt-closed reply keeps its kept reasoning for the next turn

- **WHEN** an interrupt closes a reply with a signed reasoning part followed by a text part, and the next turn runs on the same model
- **THEN** the next turn carries that reasoning part
- **AND** a reply that a cancellation or an expiry closed carries no reasoning into the next turn

#### Scenario: A completed segment of a failed Run keeps its reasoning

- **WHEN** a steer closes the first segment reply `completed` with a reasoning part, the Run then fails in its second segment, and turn 2 runs on the same model
- **THEN** the first request of turn 2 carries the reasoning part of the first segment
- **AND** it carries no reasoning part of the failed second segment
