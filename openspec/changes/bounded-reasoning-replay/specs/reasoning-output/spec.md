## ADDED Requirements

### Requirement: Replayed reasoning is bounded by dropping whole replies, oldest first

On a wire the bound applies to, when a request that continues a Chat would not fit the target model's context window and reserved output budget, the system SHALL stop replaying reasoning one earlier assistant reply at a time, oldest first, leaving out all of that reply's reasoning parts with their provider metadata, until the request fits or no droppable reasoning remains. This SHALL happen before compaction is selected.

#### Scenario: A request that fits replays every part

- **WHEN** a request that continues a Chat fits the target model's context window and reserved output budget with every stored reasoning part
- **THEN** every reasoning part and its provider metadata are replayed as before
- **AND** no reasoning is left out

#### Scenario: Reasoning the window cannot hold no longer fails the run

- **WHEN** a request that continues a Chat exceeds the target model's context window only because of its replayed reasoning
- **AND** the window compaction cannot run, for example because the previous completed Run's model can no longer execute
- **THEN** the oldest replies' reasoning is left out until the request fits
- **AND** the window compaction variant is not selected and the run does not fail `context_incompatible`
- **AND** when the measured context size is below the target model's compaction threshold, the target model is invoked with that request
- **AND** when it reaches the threshold, the threshold variant summarizes the history with the target model's own client and the target model is invoked after it, under the existing checkpoint contract

#### Scenario: Under the default reserve and threshold the target model compacts

- **WHEN** no output tokens are reserved and the model declares no explicit compaction threshold
- **AND** a request that continues a Chat exceeds the target model's context window only because of its replayed reasoning
- **AND** no earlier completed Run supplies a measured context size, so the measured context size is the bounded request's estimate
- **AND** every reply whose reasoning the bound leaves out holds less than a fifth of the window in reasoning
- **THEN** the bounded request fits the window and its measured context size reaches the default threshold
- **AND** the threshold variant publishes a checkpoint summarized by the target model, and the previous completed Run's model is not invoked

#### Scenario: Reasoning yields before visible history is summarized

- **WHEN** a request that continues a Chat does not fit its target window with every stored reasoning part, fits once older replies' reasoning is left out, and its measured context size is below the target model's compaction threshold
- **THEN** no compaction runs
- **AND** every user and assistant row above the active checkpoint keeps its visible text and tool observations in the request

#### Scenario: Leaving reasoning out never truncates or edits a part

- **WHEN** the bound leaves reasoning out of a request
- **THEN** each part left out is absent together with its text and its provider metadata
- **AND** each replayed part's text and metadata are byte-identical to what was persisted, in their stored order
- **AND** no part is truncated, edited, or re-ordered

#### Scenario: Older replies yield first

- **WHEN** two earlier replies both carry reasoning and the request fits once one reply's reasoning is left out
- **THEN** the older reply's reasoning is left out and the newer reply's reasoning is replayed
- **AND** the replayed reasoning always belongs to the most recent replies, with no earlier reply's reasoning replayed after a later reply's was left out

#### Scenario: A reply's reasoning goes as a whole

- **WHEN** an earlier reply holds several reasoning parts, including the parts of one Responses reasoning item of which only the last carries the encrypted content
- **THEN** the request replays either all of that reply's reasoning parts or none of them

#### Scenario: A request that still does not fit proceeds to compaction selection

- **WHEN** a request that continues a Chat does not fit its target window even with every droppable reply's reasoning left out
- **THEN** compaction selection evaluates that request under the existing checkpoint contract
- **AND** the window variant and its `context_incompatible` outcomes are unchanged

#### Scenario: The bound weighs reasoning by its text

- **WHEN** a reasoning part carries short text and large opaque provider metadata
- **THEN** the bound weighs the part by its text, as the request admission estimate does
- **AND** no provider metadata value is read, logged, or measured

#### Scenario: A compaction request is unaffected

- **WHEN** a compaction request is built
- **THEN** it carries no reasoning, as before, and the bound does not apply

#### Scenario: A reasoning-only reply left out contributes nothing

- **WHEN** an earlier assistant reply holds only reasoning parts and the bound leaves out its reasoning
- **THEN** that reply contributes no message to the request
- **AND** every other row keeps its place in the request

### Requirement: The reasoning bound never drops reasoning a provider requires

The bound SHALL leave out only reasoning of assistant replies that precede the request's triggering user message, and SHALL NOT leave out the reasoning of the turn in progress, or of the most recent prior reply when that reply ends on a tool call and its result. It SHALL apply only on the `anthropic-messages`, `openai-responses`, and `openai-codex` wires; on other wires every stored part SHALL replay as before.

#### Scenario: The turn in progress keeps its reasoning

- **WHEN** a Run whose request left out earlier replies' reasoning continues its tool loop after a tool result within the same turn
- **THEN** the continuation carries that turn's own reasoning with its provider metadata, unchanged
- **AND** only replies that precede the triggering user message were ever left out

#### Scenario: A latest reply that ends on a tool pair keeps its reasoning

- **WHEN** the most recent assistant reply before the triggering user message ends on a tool call and its result, for example because its Run was cancelled, failed, or reached its step limit after a tool completed
- **AND** the request would still not fit once every older reply's reasoning is left out
- **THEN** that reply's reasoning is replayed with its provider metadata
- **AND** only older replies' reasoning is left out, and the request proceeds to compaction selection if it still does not fit

#### Scenario: Replayed Messages-wire thinking stays an unbroken run

- **WHEN** the bound leaves reasoning out of an `anthropic-messages` request
- **THEN** the replayed thinking blocks are the most recent ones, in their original order, with no stored block missing between two replayed blocks
- **AND** the consecutive blocks of any one replayed assistant message are all replayed

#### Scenario: Chat Completions requests are not bounded

- **WHEN** a request that would be bounded on another wire targets an `openai-completions` or `opencode-go` provider
- **THEN** every stored reasoning part is replayed as before
- **AND** the request proceeds to compaction selection, and fails `context_incompatible` exactly where it does today

### Requirement: Reasoning a request leaves out stays in the Chat

Leaving reasoning out of a request SHALL NOT change what is stored. The parts left out and their provider metadata SHALL remain persisted, rendered, exported, copied by forks, and excluded from search exactly as before, and a later request whose target window holds them SHALL replay them again. The owner SHALL see no additional marker or notice for reasoning a request did not replay.

#### Scenario: Reasoning left out still displays and exports

- **WHEN** a Run's request left an earlier reply's reasoning out
- **THEN** after the Run that reply's stored reasoning parts and provider metadata are unchanged
- **AND** a reloaded chat still shows that reply's Thinking panel and the markdown export still includes its reasoning text

#### Scenario: A later request with room replays it again

- **WHEN** a later request in the same Chat targets a model whose window holds every stored reasoning part
- **THEN** the reply's reasoning is replayed with its provider metadata

#### Scenario: Nothing marks reasoning that was not replayed

- **WHEN** a request left reasoning out
- **THEN** no notice is added to the request or the transcript
- **AND** the Thinking panel renders exactly as it would had the reasoning been replayed

## MODIFIED Requirements

### Requirement: Reasoning is an ordered private assistant part

Displayable reasoning SHALL persist as display-only `{ type: "reasoning", text }` assistant parts, each optionally carrying opaque provider metadata, in the exact occurrence order in which it appeared relative to text and tool parts. The same order SHALL be reconstructed by live streaming, reconnect replay, and historical chat loading. Persisted reasoning text SHALL be the text the provider produced, unmodified and untruncated, and SHALL be retained with the chat until normal deletion. Reasoning parts SHALL be excluded from chat search and public shares, and from the history a compaction request summarizes. Replay is a property of the request kind, not of the projection: when a request is built to continue a Chat, that Chat's stored reasoning parts SHALL be offered to the provider in their occurrence position, except the parts of whole earlier replies that the bound in "Replayed reasoning is bounded by dropping whole replies, oldest first" drops, each with its text and any provider metadata byte-identical to what was persisted; the selected adapter carries every part its wire can represent (Chat Completions: the text as `reasoning_content`; Responses: parts that carry an item id or encrypted content) and omits the rest without failing the request. An assistant message whose only parts are reasoning SHALL still enter model context, unless that bound leaves out all of its reasoning, in which case it contributes nothing to that request. The metadata SHALL stay opaque and SHALL NOT be rendered, exported, indexed, or published. This narrows exactly one exclusion — reuse by the Chat's own provider requests — and leaves the parts' privacy posture unchanged everywhere else.

#### Scenario: Interleaved output survives reload faithfully

- **WHEN** a run emits reasoning, visible text, a tool activity part, more reasoning, and more visible text in that order
- **THEN** the persisted assistant message and a reloaded chat retain that exact part order

#### Scenario: Reasoning stays private and display-only

- **WHEN** a compaction summary is built, search indexes a chat, or a chat is viewed through a public share
- **THEN** no reasoning-part text or provider metadata is included in that summary, index, or public payload

#### Scenario: Compaction and continuation share one projection

- **WHEN** a compaction request and a continuation request are built from the same stored messages
- **THEN** the continuation carries their reasoning parts, apart from any whole replies' parts the reasoning bound drops, and the compaction request carries none
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

### Requirement: Reasoning parts carry durable provider metadata

An assistant reasoning part MAY carry opaque provider metadata supplied by the adapter that produced it (for the Responses wire: the reasoning item id on every part of an item, and the item's encrypted content on whichever part the adapter attaches it to, read from the adapter's reasoning start and end stream parts). That metadata SHALL persist with the part in the chat's message parts, SHALL be replayed to the provider on later requests that continue the same Chat together with the part's unmodified text, unless the bound in "Replayed reasoning is bounded by dropping whole replies, oldest first" drops the part together with its text, and SHALL stay opaque: never rendered, exported, indexed, included in a public share, or written to logs, telemetry, or errors. Its presence SHALL NOT change the part's display text, its order relative to other parts, or the treatment of reasoning text elsewhere in the system.

#### Scenario: Provider metadata persists with the reasoning part

- **WHEN** an adapter supplies metadata for a reasoning part
- **THEN** the metadata is persisted with that part and survives a reload of the chat

#### Scenario: Provider metadata is replayed for the same Chat

- **WHEN** a later request continues the same Chat
- **THEN** the provider metadata accompanies its reasoning part to the provider as that wire's reasoning input
- **AND** parts sharing one reasoning item are replayed as that item, whichever part carried its encrypted content
- **AND** a part the reasoning bound drops is absent together with its metadata, never one without the other

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
