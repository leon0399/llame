## Purpose

Execute Claude models through Anthropic's Messages API — natively and at
operator-supplied compatible gateways — under llame's existing configuration,
execution, telemetry, and failure contracts.

## ADDED Requirements

### Requirement: Anthropic providers execute against their configured destination

A model whose provider entry has `type: "anthropic"` SHALL execute against
Anthropic's Messages API. An `anthropic` provider MAY set `baseUrl` to target
Anthropic behind a proxy. A provider with `type: "anthropic-compatible"` SHALL
execute the Messages wire format against the operator-supplied `baseUrl`, which
it SHALL use as its only destination. The provider's `id` SHALL NOT select or
alter the client: no behavior SHALL be inferred from an entry's `id`, `baseUrl`,
or any other field. Both types SHALL share one Messages implementation, and
neither SHALL fall back to another provider, transport, or provider-owned
executor.

#### Scenario: Native provider uses Anthropic's own endpoint

- **WHEN** a run's model resolves to a `type: "anthropic"` provider that sets no
  `baseUrl`
- **THEN** the request is served by Anthropic's Messages API
- **AND** the response streams under the existing run contract

#### Scenario: Native provider behind a proxy

- **WHEN** a `type: "anthropic"` provider sets `baseUrl`
- **THEN** that endpoint serves the request
- **AND** the destination is not rewritten to Anthropic's default endpoint

#### Scenario: Compatible provider uses the operator's gateway

- **WHEN** a `type: "anthropic-compatible"` provider sets `baseUrl`
- **THEN** requests are sent to that base URL in the Messages wire format

#### Scenario: A provider id does not select the client

- **WHEN** an operator-chosen provider `id` or `baseUrl` suggests a different
  vendor than the entry's `type`
- **THEN** the client is selected by `type` alone

#### Scenario: Two providers of the same type route independently

- **WHEN** two models name two distinct providers of the same Anthropic type
- **THEN** each executes against its own provider's credential and endpoint

### Requirement: Configuration posture is operator-owned

The system SHALL NOT validate at boot that a provider's `baseUrl` matches the
shape, host, or vendor implied by its `type`. It SHALL NOT warn, correct,
migrate, or reinterpret an entry whose `baseUrl` does not appear to serve the
Messages API. A provider whose endpoint is unreachable, misconfigured, or
speaking a different wire format SHALL surface that failure at request time under
the existing run failure contract, never as a boot failure or a silent retarget
to another destination.

#### Scenario: A mismatched gateway is not corrected at boot

- **WHEN** a provider's `baseUrl` points at an endpoint that does not serve the
  Messages API
- **THEN** startup succeeds and no warning about the mismatch is emitted
- **AND** the failure appears at request time

#### Scenario: An unreachable endpoint does not block startup

- **WHEN** a provider's `baseUrl` host is unreachable
- **THEN** startup succeeds, models on other providers remain executable, and
  the affected requests fail with a bounded diagnostic

#### Scenario: A stale configuration is not reinterpreted

- **WHEN** a previously valid entry's endpoint no longer corresponds to the
  vendor its `type` names
- **THEN** the entry is used exactly as authored rather than migrated or
  re-pointed

### Requirement: Credentials resolve through interpolation and are never disclosed

A provider `key` SHALL resolve from the existing `{env:…}` / `{path:…}`
interpolation once at process startup. A resolved credential SHALL never appear
in logs, errors, telemetry, persisted records, owner-visible output, or any
diagnostic, including upstream failures that echo request details. A load-time
error concerning an Anthropic provider field SHALL identify the entry by `id` and
the field name, never the resolved value or referenced file contents. An empty
resolved `key` SHALL mark the provider keyless under the existing
empty-resolution-means-unset semantics.

#### Scenario: Credentials are never exposed

- **WHEN** a provider `key` resolves to a credential and a request or load fails
  for that provider
- **THEN** the resolved value appears in no log line, error, telemetry record,
  or diagnostic output
- **AND** any error about the entry names it by `id` and field, not by value

#### Scenario: Missing credentials fail at request time

- **WHEN** a provider's `key` resolves to empty and the endpoint requires
  authentication
- **THEN** the request fails with a sanitized authentication diagnostic
- **AND** no other provider, credential, or provider type is substituted

#### Scenario: Load errors name the field, not the secret

- **WHEN** an interpolated provider field cannot be resolved
- **THEN** startup fails identifying the entry `id` and the field, without the
  resolved value or file contents

### Requirement: Thinking blocks are persisted and replayed complete and unmodified

When an Anthropic model emits thinking or redacted thinking, the client SHALL
surface it as a displayable reasoning part, persist that block's provider-issued
signature (and its redacted payload, where present) as opaque provider metadata on
the same reasoning part through the per-reasoning-part provider-metadata channel
introduced by the `openai-compatible-provider` change for GitHub issue #883, and
replay the block on later requests for the same chat. Within a
tool-use turn the blocks SHALL be passed back; across turns the system SHALL pass
back everything it holds. The system SHALL NOT prune thinking blocks itself: the
Messages API filters them, keeps the blocks needed to preserve the model's
reasoning, and bills input tokens only for the blocks actually shown to the
model. Replayed blocks SHALL be complete and unmodified, and the consecutive
thinking blocks of the latest assistant message SHALL NOT be rearranged, edited,
or partially dropped, because a modified block is rejected.

A replay SHALL be safe when the prefix above it has changed. A thinking block
stays valid only while the top-level `system` prompt, the `tools`, and the
messages before it are unchanged, and llame rewrites that prefix on compaction
and on prompt-receipt changes, so the request SHALL explicitly instruct the
provider to drop blocks whose bound prefix no longer matches instead of failing,
and SHALL do so rather than inherit whatever the account's default enforcement
happens to be. The same behavior SHALL hold within a single run, where compaction
can rewrite the prefix mid-turn.

When the request's model differs from the model that produced a replayed block,
the block SHALL still be replayed unchanged: a thinking block is readable only by
the model that produced it or a newer one, and the provider ignores or drops the
blocks the target model cannot read. The client SHALL NOT coerce a signed block
to plain text, strip it, or otherwise rewrite it because of a model switch, and
SHALL NOT prune prior turns' thinking itself.

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

#### Scenario: Reasoning is rendered for the owner

- **WHEN** a run emits reasoning
- **THEN** the owner sees it under the existing reasoning-part contract
- **AND** no new rendering path is required

#### Scenario: No thinking output is not a failure

- **WHEN** a response contains no thinking output
- **THEN** the run completes normally

### Requirement: Prompt caching is requested at the request level

The client SHALL set the Anthropic ephemeral cache control at the top level of
every request it sends, for both provider types, using the provider's default
5-minute cache lifetime. The system SHALL NOT author block-level cache markers,
SHALL NOT count or budget cache breakpoints, and SHALL NOT expose the longer
1-hour cache lifetime. A gateway that ignores the option MAY serve the request
without caching; a gateway that rejects the option SHALL fail at request time
under the existing failure contract rather than being detected at boot.

#### Scenario: Both provider types request caching

- **WHEN** a run executes against an `anthropic` or `anthropic-compatible`
  provider
- **THEN** the request carries the top-level ephemeral cache control

#### Scenario: llame places no cache breakpoints

- **WHEN** llame renders a request
- **THEN** no content block authored by llame carries a cache-control marker
- **AND** the breakpoint count does not depend on llame logic

#### Scenario: A cacheable stable prefix is re-served from cache

- **WHEN** a chat reuses a stable prefix that meets the provider's cacheable
  minimum across turns on the same provider
- **THEN** subsequent turns report cache-read tokens for that prefix
- **AND** the prefix is billed at the cache-read rate

#### Scenario: A gateway that ignores the option still completes

- **WHEN** a compatible gateway does not implement cache control
- **THEN** the request succeeds without cache-read tokens
- **AND** the absence of caching is not reported as a failure

#### Scenario: The longer cache lifetime is not requested

- **WHEN** any Anthropic request is sent
- **THEN** no 1-hour cache lifetime is requested

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

### Requirement: Reasoning effort maps onto the provider's thinking option

A request to an Anthropic provider SHALL map the run's resolved effort onto the
adapter's thinking option and SHALL NOT introduce a second effort vocabulary, a
new configuration field, or a provider-specific override of the existing effort
resolution. The existing effective-effort behavior, including rejection of an
effort the model does not declare, SHALL apply unchanged.

#### Scenario: A declared effort reaches the provider

- **WHEN** a model declares an effort vocabulary and a run resolves to one of its
  levels
- **THEN** the request carries the corresponding thinking option

#### Scenario: An undeclared effort is refused before the provider

- **WHEN** a run requests an effort for a model whose catalog entry declares no
  reasoning configuration
- **THEN** the existing unsupported-effort response applies
- **AND** no Anthropic request is made

#### Scenario: No llame-owned effort vocabulary is introduced

- **WHEN** an operator authors effort levels
- **THEN** the declared values are the only ones the provider receives
- **AND** no llame-defined level names are substituted

### Requirement: Structured output uses the provider's forced tool choice

Schema-constrained auxiliary generation SHALL use the Messages API's native
forced tool choice, the same mechanism the existing bound-object generation path
already depends on. No fallback generation strategy, prompt-injected schema, or
provider-specific bypass SHALL be added for Anthropic, and an unsupported
combination SHALL fail explicitly rather than degrade silently.

#### Scenario: Bound-object generation is tool-bound

- **WHEN** a caller requests a schema-constrained object through an Anthropic
  provider
- **THEN** the request forces the named tool and the response is validated
  against that schema
- **AND** no prompt-injected schema or plain-text parsing path is used

### Requirement: Failure boundaries are bounded and sanitized

Authentication failures, unknown or invalid model identifiers, rate limits, and
unsupported request options SHALL fail the affected request under the existing
run failure contract with sanitized diagnostics. The client SHALL NOT silently
discard a meaningful unsupported request option, retry against a different
credential, fall back to another provider or provider type, or represent a
failure as a successful run. Already-recorded parts and tool effects SHALL be
retained under the existing durability rules.

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

#### Scenario: An unsupported option fails explicitly

- **WHEN** a request carries an option the selected adapter cannot honor
- **THEN** the request fails explicitly rather than dropping the option silently
