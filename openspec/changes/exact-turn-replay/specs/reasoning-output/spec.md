## ADDED Requirements

### Requirement: Earlier reasoning replays only for the model that produced it

A reasoning part of an earlier turn MUST replay only when two conditions are
true. Its reply came from a Run with the llame model id of the request, and that
Run completed. Otherwise the
system MUST omit the part and its provider metadata. Within one turn, and in the
kept parts of a Continue Run, a reasoning part MUST replay on the model of its
Run. The system MUST NOT select reasoning parts by their content or
their age.

#### Scenario: The same model keeps earlier reasoning

- **WHEN** turn 1 completed on the model `sonnet` with a reasoning part, and turn 2 runs on `sonnet`
- **THEN** the first request of turn 2 carries that reasoning part with its provider metadata

#### Scenario: A model switch omits earlier reasoning

- **WHEN** turn 1 completed on `sonnet` with a reasoning part, and turn 2 runs on `glm-5`
- **THEN** the first request of turn 2 carries no reasoning part of turn 1
- **AND** it carries the text and the tool activity of turn 1

#### Scenario: The reasoning of a failed reply is omitted

- **WHEN** the Run of turn 1 failed after a reasoning part, and turn 2 runs on the same model
- **THEN** the first request of turn 2 carries no reasoning part of turn 1
- **AND** it carries the text and the tool activity of turn 1

#### Scenario: Continue keeps the reasoning of a failed Run

- **WHEN** the owner continues a `failed` Run on its model, and a kept step holds a reasoning part
- **THEN** the first request of the Continue Run carries that reasoning part with its provider metadata

#### Scenario: A return to the first model replays its reasoning

- **WHEN** turn 1 completed on `sonnet`, turn 2 completed on `glm-5`, and turn 3 runs on `sonnet`
- **THEN** the first request of turn 3 carries the reasoning parts of turn 1
- **AND** it carries no reasoning part of turn 2

## MODIFIED Requirements

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

- **WHEN** a worker restarts between a tool call and its continuation, and the resumed Run rebuilds the request from persisted parts
- **THEN** the continuation carries the earlier reasoning part with its metadata and its unchanged text

#### Scenario: Provider metadata is never rendered or published

- **WHEN** a chat is displayed, exported as markdown, indexed for search, or viewed through a public share
- **THEN** no provider metadata appears in that output

#### Scenario: Provider metadata never reaches a diagnostic sink

- **WHEN** a request that carries replayed provider metadata fails, or the run writes logs or telemetry for it
- **THEN** the metadata value appears in no log line, telemetry field, or error

#### Scenario: A reasoning part without metadata is unchanged

- **WHEN** a reasoning part carries no provider metadata
- **THEN** its persisted shape, display, and order stay as before
