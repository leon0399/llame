## Purpose

Execute Claude models through Anthropic's Messages wire — at Anthropic or at
any operator-supplied endpoint that speaks it — under llame's existing
configuration, execution, telemetry, and failure contracts. Destination
selection, the operator-owned configuration posture, credential handling, and
the per-model provider-options channel are owned by `provider-api-selection`
and `instance-config`; this capability specifies only what the Messages wire
adds: thinking persistence and replay, the caching default, cache-write cost,
the effort and thinking defaults, structured output, and failure boundaries.

## ADDED Requirements

### Requirement: Thinking blocks are persisted and replayed complete and unmodified

When an Anthropic model emits thinking or redacted thinking, the client SHALL
surface it as a displayable reasoning part, persist that block's provider-issued
signature (and its redacted payload, where present) as opaque provider metadata on
the same reasoning part through the per-reasoning-part provider-metadata channel
`reasoning-output` defines, and replay the block on later requests for the same
chat. Within a tool-use turn the blocks SHALL be passed back; across turns the
system SHALL pass back everything it holds. The system SHALL NOT prune thinking
blocks itself: the Messages API filters them, keeps the blocks needed to preserve
the model's reasoning, and bills input tokens only for the blocks actually shown
to the model. Replayed blocks SHALL be complete and unmodified, and the
consecutive thinking blocks of the latest assistant message SHALL NOT be
rearranged, edited, or partially dropped, because a modified block is rejected.
A block whose text the provider withheld SHALL be persisted and replayed exactly
like any other: its empty text is the text the provider produced, and its
signature is what the replay needs.

A replay SHALL be safe when the prefix above it has changed. A thinking block
stays valid only while the top-level `system` prompt, the `tools`, and the
messages before it are unchanged, and llame rewrites that prefix on compaction
and on prompt-receipt changes, so every request SHALL explicitly instruct the
provider to drop blocks whose bound prefix no longer matches instead of failing,
and SHALL do so rather than inherit whatever the account's default enforcement
happens to be. This instruction is a client invariant under
`provider-api-selection`'s precedence: an operator's `providerOptions` SHALL NOT
remove or override it. The same behavior SHALL hold within a single run, where
compaction can rewrite the prefix mid-turn.

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

#### Scenario: Replay preserves block order and content

- **WHEN** the latest assistant message holds several consecutive thinking blocks
- **THEN** they are replayed in their original order, byte for byte, with none
  edited and none partially dropped

#### Scenario: A rewritten prefix drops stale blocks instead of failing

- **WHEN** compaction or a prompt-receipt change rewrites the system prompt,
  tools, or earlier messages above a replayed thinking block
- **THEN** the request explicitly asks the provider to drop the stale-bound
  blocks and the run continues without a rejection

#### Scenario: A mid-run compaction does not fail the continuation

- **WHEN** compaction rewrites the prefix during an active run and the turn then
  continues with a tool result
- **THEN** the continuation still succeeds under the drop behavior rather than
  failing with a rejection

#### Scenario: The drop instruction cannot be configured away

- **WHEN** a model entry's `providerOptions` sets the prefix-mismatch behavior
  to error or to `null`
- **THEN** every request still carries the drop instruction

#### Scenario: A model switch replays blocks unchanged

- **WHEN** a later request uses a different model than the one that produced a
  persisted thinking block
- **THEN** the block is replayed unchanged
- **AND** llame neither coerces it to plain text nor strips it

#### Scenario: llame does not prune prior thinking

- **WHEN** a chat's history holds signed thinking blocks from earlier turns
- **THEN** llame replays them without pruning
- **AND** the provider decides which blocks are retained and billed

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

### Requirement: Prompt caching is a request-level client default

The client SHALL default the Anthropic ephemeral cache control at the top level
of every request it sends, using the provider's default 5-minute cache lifetime,
so the provider itself places the breakpoint on the last cacheable block. The
system SHALL NOT author block-level cache markers and SHALL NOT count or budget
cache breakpoints. The default is a client default under
`provider-api-selection`'s precedence: an operator MAY replace it (for example
with the provider's longer lifetime) or remove it with `null` through the model
entry's `providerOptions`. A gateway that ignores the option MAY serve the
request without caching; a gateway that rejects the option SHALL fail at request
time under the existing failure contract rather than being detected at boot.

#### Scenario: Requests carry the ephemeral cache control by default

- **WHEN** a run executes against an `anthropic-messages` provider whose model
  entry sets no cache-control option
- **THEN** the request carries the top-level ephemeral cache control with the
  provider's default lifetime

#### Scenario: llame places no cache breakpoints

- **WHEN** llame renders a request
- **THEN** no content block authored by llame carries a cache-control marker
- **AND** the breakpoint count does not depend on llame logic

#### Scenario: A cacheable stable prefix is re-served from cache

- **WHEN** a chat reuses a stable prefix that meets the provider's cacheable
  minimum across turns on the same provider
- **THEN** subsequent turns report cache-read tokens for that prefix
- **AND** the prefix is billed at the cache-read rate

#### Scenario: An operator removes or replaces the default

- **WHEN** a model entry's `providerOptions` sets the cache-control option to
  `null`, or to a value naming the provider's longer lifetime
- **THEN** the request omits the option, or carries the operator's value, in
  place of the default

#### Scenario: A gateway that ignores the option still completes

- **WHEN** a Messages-compatible gateway does not implement cache control
- **THEN** the request succeeds without cache-read tokens
- **AND** the absence of caching is not reported as a failure

### Requirement: Cache-write usage is reported and priced

The client SHALL report the provider's cache-creation token count as cache-write
tokens in run and assistant usage telemetry. Generated-time `costUsd` SHALL price
those tokens at the model entry's declared cache-write rate when it declares one,
and otherwise at that entry's input rate, matching the existing fallback used for
cached input. A model entry that declares no `pricingUsdPer1M` SHALL keep the
existing unknown-cost contract (`costUsd: null`). Cache-write tokens SHALL be
provider-reported and SHALL NOT be inferred, estimated, or backfilled from other
token counts.

#### Scenario: Cache-write tokens are reported

- **WHEN** an Anthropic response reports cache-creation tokens
- **THEN** run and assistant usage telemetry record those tokens
- **AND** they remain distinguishable from cached-input and uncached input tokens

#### Scenario: Cost prices cache-write tokens at the declared rate

- **WHEN** a model entry declares a cache-write rate and the provider reports
  cache-write tokens
- **THEN** `costUsd` prices those tokens at that rate rather than the input rate

#### Scenario: An absent cache-write rate falls back to input

- **WHEN** a model entry declares input and output pricing but no cache-write rate
- **THEN** cache-write tokens are priced at the input rate
- **AND** the run still reports a non-null cost

#### Scenario: No cache-write tokens are invented

- **WHEN** the provider reports no cache-creation count
- **THEN** zero cache-write tokens are recorded and no value is estimated

### Requirement: Reasoning effort maps onto the provider's effort option with adaptive thinking as the default

A request to an `anthropic-messages` provider SHALL place the run's resolved
effort in the adapter's effort option, verbatim, and SHALL NOT introduce a second
effort vocabulary, a new configuration field, or a provider-specific override of
the existing effort resolution. The existing effective-effort behavior, including
rejection of an effort the model does not declare, SHALL apply unchanged.

When a model entry declares a `reasoning` vocabulary, the client SHALL default
the adapter's thinking option to adaptive thinking with summarized display, so
the effort the owner selects governs thinking depth and the reasoning the
provider summarizes is visible under the existing reasoning-part contract. When a
model entry declares no `reasoning` vocabulary, the client SHALL send no thinking
mode and no effort, leaving the model's own default in force. Both defaults are
client defaults under `provider-api-selection`'s precedence: an operator MAY
replace or remove them through the entry's `providerOptions`, for example to
omit the display option on a model that rejects it or to declare a token budget
for a model without adaptive thinking. The client SHALL NOT author a thinking
budget, a per-model thinking mode, or any model-family table of its own.

#### Scenario: A declared effort reaches the provider as the effort option

- **WHEN** a model declares an effort vocabulary and a run resolves to one of its
  levels
- **THEN** the request carries that level, verbatim, as the adapter's effort
  option

#### Scenario: A declared vocabulary enables adaptive thinking with visible summaries

- **WHEN** a model entry declares `reasoning` and sets no thinking option in
  `providerOptions`
- **THEN** the request carries adaptive thinking with summarized display
- **AND** the summarized thinking is persisted and rendered as reasoning parts

#### Scenario: An operator replaces the thinking default

- **WHEN** a model entry's `providerOptions` sets the adapter's thinking option
  (for example adaptive thinking without a display value, or a token budget)
- **THEN** the request carries the operator's thinking option in place of the
  default
- **AND** the drop-on-prefix-mismatch instruction is still present

#### Scenario: A model without a reasoning declaration sends no thinking mode

- **WHEN** a model entry omits `reasoning` and sets no thinking option in
  `providerOptions`
- **THEN** the request carries no thinking mode and no effort option
- **AND** the model's own default thinking behavior applies
- **AND** the drop-on-prefix-mismatch instruction is still present

#### Scenario: An undeclared effort is refused before the provider

- **WHEN** a run requests an effort for a model whose catalog entry declares no
  reasoning configuration
- **THEN** the existing unsupported-effort response applies
- **AND** no Anthropic request is made

#### Scenario: No llame-owned effort vocabulary is introduced

- **WHEN** an operator authors effort levels
- **THEN** the declared values are the only ones the provider receives
- **AND** no llame-defined level names are substituted

### Requirement: Structured output uses the adapter's native structured-output path

Schema-constrained auxiliary generation through an `anthropic-messages` provider
SHALL request a JSON response format from the adapter and let the adapter select
the provider's mechanism: the native output format on models that support it,
and the adapter's own JSON tool otherwise. The client SHALL NOT force a named or
required tool choice to obtain structured output, because current Claude models
reject forced tool use, and SHALL NOT add a prompt-injected schema, text-parsing
fallback, or provider-specific bypass. A generation the provider rejects SHALL
fail explicitly and fall through to the caller's existing plain-text fallback,
never to another mechanism, model, or provider.

#### Scenario: Bound-object generation uses the native output format

- **WHEN** a caller requests a schema-constrained object (e.g. a chat title)
  through an `anthropic-messages` provider whose model supports the native
  output format
- **THEN** the request carries the schema as the provider's output format and no
  forced tool choice
- **AND** the returned object is validated against the schema

#### Scenario: A forced tool choice is never used for structured output

- **WHEN** a schema-constrained object is requested through an
  `anthropic-messages` provider
- **THEN** no request carries a named or required tool choice for that purpose

#### Scenario: A rejected structured generation falls through to the caller

- **WHEN** the provider rejects the structured request
- **THEN** the request fails explicitly
- **AND** the caller's existing plain-text fallback runs, with no other
  mechanism, model, or provider substituted

### Requirement: Failure boundaries are bounded and sanitized

Authentication failures, unknown or invalid model identifiers, rate limits, and
rejected request options SHALL fail the affected request under the existing run
failure contract with sanitized diagnostics. The client SHALL NOT retry against a
different credential, fall back to another provider or provider type, or
represent a failure as a successful run. Already-recorded parts and tool effects
SHALL be retained under the existing durability rules. A `providerOptions` value
the adapter recognizes and rejects SHALL fail the request rather than being
dropped; a key the adapter does not recognize is the adapter's to drop or forward
under `provider-api-selection`, and SHALL NOT cause llame to rewrite or retarget
the request.

#### Scenario: Authentication failure is bounded to the request

- **WHEN** an Anthropic endpoint rejects the configured credential
- **THEN** the affected run fails with a sanitized diagnostic
- **AND** models on other providers remain executable
- **AND** no automatic retry or credential substitution occurs

#### Scenario: Rate limits are reported without fallback

- **WHEN** the provider rate-limits a request
- **THEN** the failure is reported as a bounded diagnostic
- **AND** no paid or alternative-provider fallback occurs

#### Scenario: Upstream error bodies are not disclosed

- **WHEN** an upstream failure echoes request details
- **THEN** owner-visible output, persisted errors, logs, and telemetry contain
  only sanitized diagnostics

#### Scenario: A rejected option value fails explicitly

- **WHEN** a model entry's `providerOptions` carries a value the adapter
  recognizes and rejects
- **THEN** the request fails explicitly rather than being sent without the option

#### Scenario: An unrecognized option key does not retarget the request

- **WHEN** a model entry's `providerOptions` carries a key the adapter does not
  recognize
- **THEN** the adapter alone decides whether it is dropped or forwarded
- **AND** llame neither rewrites nor retargets the request because of it
