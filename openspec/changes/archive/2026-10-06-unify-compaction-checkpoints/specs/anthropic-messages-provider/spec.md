# Spec Delta

## MODIFIED Requirements

### Requirement: Thinking blocks are persisted and replayed complete and unmodified

When an Anthropic model emits thinking or redacted thinking, the client SHALL
surface it as a displayable reasoning part, persist that block's provider-issued
signature (and its redacted payload, where present) as opaque provider metadata on
the same reasoning part through the per-reasoning-part provider-metadata channel
`reasoning-output` defines, and replay the block on later requests for the same
chat. Within a tool-use turn the blocks SHALL be passed back; across turns the
system SHALL pass back every block within the model context the request is
built from. A prefix a checkpoint absorbed is replaced by that checkpoint
message under the existing context contract, so the blocks it held are not part
of that context and are not replayed; that replacement is not llame-side
pruning of thinking. The adapter's reasoning-replay switch SHALL stay on as a
client invariant, so an operator's `providerOptions` cannot turn replay off.
The system SHALL NOT prune thinking blocks itself within the retained context:
the Messages API filters them, keeps the blocks needed to preserve the model's
reasoning, and bills input tokens only for the blocks actually shown to the
model. Replayed blocks SHALL be complete and unmodified, and the consecutive
thinking blocks of the latest assistant message SHALL NOT be rearranged, edited,
or partially dropped, because a modified block is rejected. A block whose text
the provider withheld SHALL be persisted and replayed exactly like any other:
its empty text is the text the provider produced, and its signature is what
the replay needs.

A replay SHALL be safe when the prefix above it has changed. A thinking block
stays valid only while the top-level `system` prompt, the `tools`, and the
messages before it are unchanged, and llame rewrites that prefix on compaction
and on prompt-receipt changes, so every request that carries adaptive thinking
SHALL explicitly instruct the provider to drop blocks whose bound prefix no
longer matches instead of failing, and SHALL do so rather than inherit whatever
the account's default enforcement happens to be. The thinking block binding is
llame's, not the operator's: it is a reserved key under
`provider-api-selection`'s rule, so any value an operator's `providerOptions`
places at it is stripped, and the client sets it itself on the adaptive shape
only. The provider documents the instruction alongside adaptive and
manual-budget thinking only, and the pinned adapter carries it only on the
adaptive shape, so no request SHALL carry a thinking configuration that
consists of the instruction alone, and a request that carries no thinking
configuration or a manual-budget or disabled shape carries no instruction: an
entry that declares no `reasoning` on a model that thinks by default, or an
operator who overrides `thinking` to a manual-budget or disabled shape, gives
up the instruction for that model, which the operator documentation SHALL state
together with the remedy of declaring `reasoning`. The same behavior SHALL
hold within a single run, where compaction can rewrite the prefix mid-turn.

When the request's model differs from the model that produced a replayed block,
the block SHALL still be replayed unchanged: a thinking block is readable only by
the model that produced it or a newer one, and the provider ignores or drops the
blocks the target model cannot read. The client SHALL NOT coerce a signed block
to plain text, strip it, or otherwise rewrite it because of a model switch, and
SHALL NOT prune prior turns' thinking itself. Metadata another wire's adapter
attached to a reasoning part is not Messages metadata and SHALL NOT be sent as
a thinking block.

A response that emits no thinking output SHALL remain a successful run.

#### Scenario: Thinking survives a tool continuation

- **WHEN** a model emits a thinking block, requests an authorized tool, and the
  turn continues with the tool result
- **THEN** the continuation carries the earlier thinking block with its signature
  and the provider accepts it

#### Scenario: Thinking survives into a later turn

- **WHEN** a chat issues a later request whose history contains a persisted
  reasoning part carrying a signature
- **THEN** the block is replayed to the provider with that signature
- **AND** the provider accepts the request

#### Scenario: Replay cannot be switched off by configuration

- **WHEN** a model entry's `providerOptions` sets the adapter's reasoning-replay
  switch to off or to `null`
- **THEN** the request still carries the persisted thinking blocks
- **AND** the operator value is not sent

#### Scenario: Replay preserves block order and content

- **WHEN** the latest assistant message holds several consecutive thinking blocks
- **THEN** they are replayed in their original order, byte for byte, with none
  edited and none partially dropped

#### Scenario: A rewritten prefix drops stale blocks instead of failing

- **WHEN** a request carrying adaptive thinking follows a compaction or a
  prompt-receipt change that rewrote the system prompt, tools, or earlier
  messages above a replayed thinking block
- **THEN** the request explicitly asks the provider to drop the stale-bound
  blocks and the run continues without a rejection

#### Scenario: A mid-run compaction does not fail the continuation

- **WHEN** compaction rewrites the prefix during an active run whose requests
  carry adaptive thinking and the turn then continues with a tool result
- **THEN** the continuation still succeeds under the drop behavior rather than
  failing with a rejection

#### Scenario: An operator-supplied block binding is stripped

- **WHEN** a model entry's `providerOptions` places any value at the thinking
  block binding — error, drop, or `null` — with or without a thinking type
- **THEN** that value is stripped before composition
- **AND** a request carrying adaptive thinking still carries llame's drop
  instruction, and a request carrying no thinking configuration carries no
  instruction-only thinking object

#### Scenario: A request without adaptive thinking carries no drop instruction

- **WHEN** a model entry declares no `reasoning` and sets no thinking option, or
  its `providerOptions` sets `thinking` to the manual-budget or the disabled
  shape
- **THEN** the request carries no drop instruction and no instruction-only
  thinking configuration
- **AND** the operator documentation records that a prefix rewrite can then be
  rejected under the account's default enforcement, and that declaring
  `reasoning` restores the instruction on models with adaptive thinking

#### Scenario: A model switch replays blocks unchanged

- **WHEN** a later request uses a different model than the one that produced a
  persisted thinking block
- **THEN** the block is replayed unchanged
- **AND** llame neither coerces it to plain text nor strips it

#### Scenario: llame does not prune prior thinking

- **WHEN** a chat's retained model context holds signed thinking blocks from
  earlier turns
- **THEN** llame replays them without pruning
- **AND** the provider decides which blocks are retained and billed

#### Scenario: A compacted prefix's blocks are not replayed

- **WHEN** compaction has superseded a prefix that held signed thinking blocks
  and a later request is built
- **THEN** the request carries the compaction's checkpoint message in place of
  that prefix, without the superseded blocks
- **AND** blocks in the context after the checkpoint's absorbed-through
  sequence are replayed unchanged

#### Scenario: Redacted thinking survives a tool continuation

- **WHEN** the model emits a redacted thinking block
- **THEN** the block is replayed unchanged on the continuation
- **AND** llame does not attempt to decode or display redacted payload contents

#### Scenario: Withheld thinking text is persisted with its signature

- **WHEN** the provider returns a thinking block whose text is empty and whose
  signature is present
- **THEN** a reasoning part with empty text and that signature is persisted
- **AND** a later request replays the block with the signature

#### Scenario: Another wire's metadata is not replayed as thinking

- **WHEN** a chat's history holds a reasoning part whose provider metadata was
  attached by a Responses-wire adapter and the chat continues on an
  `anthropic-messages` provider
- **THEN** no thinking block is synthesized from that metadata
- **AND** the request succeeds

#### Scenario: Reasoning is rendered for the owner

- **WHEN** a run emits reasoning text
- **THEN** the owner sees it under the existing reasoning-part contract
- **AND** no new rendering path is required

#### Scenario: No thinking output is not a failure

- **WHEN** a response contains no thinking output
- **THEN** the run completes normally
