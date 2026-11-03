## MODIFIED Requirements

### Requirement: Thinking blocks are persisted and replayed complete and unmodified

When an Anthropic model emits thinking or redacted thinking, the client MUST show
it as a displayable reasoning part. It MUST persist the signature of that block
as opaque provider metadata on the same reasoning part. It MUST also persist the
redacted payload of the block, where present. It uses the per-part
provider-metadata channel that `reasoning-output` defines. Within a tool-use turn,
the client MUST pass the blocks back. Across turns, it MUST pass back each block
that the model rule of `reasoning-output` keeps in the request context. The checkpoint
message replaces the prefix that the checkpoint absorbed, under the context
contract, so the blocks of that prefix do not replay. The reasoning-replay switch of
the adapter MUST stay on as a client invariant, so the `providerOptions` of an
operator cannot turn replay off.

Apart from the model rule of `reasoning-output`, llame MUST NOT prune thinking
blocks in the retained context. The Messages API filters them and keeps the
blocks that the model needs. It bills input tokens only for the blocks that it
shows to the model. Replayed blocks MUST be complete and unchanged. The consecutive
thinking blocks of the latest assistant message MUST NOT be reordered, edited, or
partly dropped, because the provider rejects a changed block. A block whose text
the provider withheld MUST be persisted and replayed like any other block. Its
empty text is the text that the provider produced, and its signature is what the
replay needs.

A replay MUST be safe when the prefix above it changes. A thinking block stays
valid only while the earlier messages, the top-level `system` prompt, and the
`tools` do not change. llame rewrites that prefix on compaction and on
prompt-receipt changes. Thus each request that carries adaptive thinking MUST
tell the provider explicitly to drop the blocks whose bound prefix no longer
matches. It MUST NOT depend on the default enforcement of the account. The
thinking block binding belongs to llame, not to the operator. It is a reserved key
under the rule of `provider-api-selection`. Thus the client strips any value that
the `providerOptions` of an operator put at it, and sets it only on the adaptive
shape. The provider documents the instruction with adaptive and manual-budget
thinking only, and the pinned adapter carries it only on the adaptive shape. A
request MUST NOT carry a thinking configuration that holds only the instruction.
A request with no thinking configuration, or with a manual-budget or disabled
shape, carries no instruction. An entry that declares no `reasoning` on a model
that thinks by default gives up the instruction for that model. An operator who
overrides `thinking` to a manual-budget or disabled shape also gives it up. The
operator documentation MUST state this, with the remedy: declare `reasoning`. The
same behavior MUST apply within one run, where compaction can rewrite the prefix
in the middle of a turn.

A replayed block follows the model rule of `reasoning-output`. After a model
switch, the request MUST omit the thinking blocks of the replies of other models.
The client MUST NOT change a signed block to plain text or rewrite it. A block
that the request keeps MUST replay unchanged. The adapter of another wire can
attach metadata to a reasoning part. That metadata is not Messages metadata, and
the client MUST NOT send it as a thinking block.

A response with no thinking output MUST stay a successful run.

#### Scenario: Thinking survives a tool continuation

- **WHEN** a model emits a thinking block, requests an authorized tool, and the turn continues with the tool result
- **THEN** the continuation carries the earlier thinking block with its signature, and the provider accepts it

#### Scenario: Thinking survives into a later turn

- **WHEN** a later request on the same model has history with a completed reply that persisted a reasoning part with a signature
- **THEN** the block is replayed to the provider with that signature
- **AND** the provider accepts the request

#### Scenario: Replay cannot be switched off by configuration

- **WHEN** the `providerOptions` of a model entry set the reasoning-replay switch of the adapter to off or to `null`
- **THEN** the request still carries the persisted thinking blocks
- **AND** the operator value is not sent

#### Scenario: Replay preserves block order and content

- **WHEN** the latest assistant message holds several consecutive thinking blocks
- **THEN** they replay in their original order, byte for byte, with no block edited and no block partly dropped

#### Scenario: A rewritten prefix drops stale blocks instead of failing

- **WHEN** a compaction or a prompt-receipt change rewrote the system prompt, the tools, or earlier messages above a replayed thinking block
- **AND** the next request carries adaptive thinking
- **THEN** the request explicitly tells the provider to drop the blocks with a stale binding
- **AND** the run continues with no rejection

#### Scenario: A mid-run compaction does not fail the continuation

- **WHEN** compaction rewrites the prefix during an active run whose requests carry adaptive thinking, and the turn then continues with a tool result
- **THEN** the continuation succeeds under the drop behavior, with no rejection

#### Scenario: An operator-supplied block binding is stripped

- **WHEN** the `providerOptions` of a model entry put any value at the thinking block binding (error, drop, or `null`), with or without a thinking type
- **THEN** the client strips that value before composition
- **AND** a request that carries adaptive thinking still carries the drop instruction of llame
- **AND** a request with no thinking configuration carries no thinking object that holds only the instruction

#### Scenario: A request without adaptive thinking carries no drop instruction

- **WHEN** a model entry declares no `reasoning` and sets no thinking option, or its `providerOptions` set `thinking` to the manual-budget or the disabled shape
- **THEN** the request carries no drop instruction and no thinking configuration that holds only the instruction
- **AND** the operator documentation states that the default enforcement of the account can then reject a prefix rewrite
- **AND** it states that a `reasoning` declaration restores the instruction on models with adaptive thinking

#### Scenario: A model switch replays blocks unchanged

- **WHEN** a later request returns to the model that produced a persisted thinking block, after a turn on another model
- **THEN** the block of that model replays unchanged
- **AND** llame does not change it to plain text or strip it

#### Scenario: A model switch omits earlier blocks

- **WHEN** a later request uses a different model than the model that produced a persisted thinking block
- **THEN** the request does not carry that block
- **AND** llame does not change it to plain text

#### Scenario: llame does not prune prior thinking

- **WHEN** the retained model context of a chat holds signed thinking blocks from earlier completed turns on the model of the request
- **THEN** llame replays them and removes none of them
- **AND** the provider decides which blocks it keeps and bills

#### Scenario: A compacted prefix's blocks are not replayed

- **WHEN** compaction has replaced a prefix that held signed thinking blocks, and a later request is built
- **THEN** the request carries the checkpoint message of the compaction in place of that prefix, without the replaced blocks
- **AND** the blocks in the context after the absorbed-through sequence of the checkpoint replay under the model rule

#### Scenario: Redacted thinking survives a tool continuation

- **WHEN** the model emits a redacted thinking block
- **THEN** the block replays unchanged on the continuation
- **AND** llame does not try to decode or show the redacted payload

#### Scenario: Withheld thinking text is persisted with its signature

- **WHEN** the provider returns a thinking block whose text is empty and whose signature is present
- **THEN** a reasoning part with empty text and that signature is persisted
- **AND** a later request replays the block with the signature

#### Scenario: Another wire's metadata is not replayed as thinking

- **WHEN** the history of a chat holds a reasoning part whose provider metadata a Responses-wire adapter attached, and the chat continues on an `anthropic-messages` provider
- **THEN** the client makes no thinking block from that metadata
- **AND** the request succeeds

#### Scenario: Reasoning is rendered for the owner

- **WHEN** a run emits reasoning text
- **THEN** the owner sees it under the reasoning-part contract
- **AND** no new render path is necessary

#### Scenario: No thinking output is not a failure

- **WHEN** a response contains no thinking output
- **THEN** the run completes normally
