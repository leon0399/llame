## Purpose

Defines what an assistant message's usage and estimated cost cover across the model requests of its Run, how incomplete or unreported usage is represented, how usage stays consistent between live streaming and reload, and which signal drives compaction, so that cost display, budgets, and the usage ledger build on one aggregate.

## ADDED Requirements

### Requirement: Message usage aggregates every model request of its attempt

An assistant message's persisted usage SHALL be the sum of the provider-reported usage of every model request made by the Run attempt that produced it, including tool-requesting requests and the final answer. Each request's usage SHALL be normalized on its own before summing: cached-input and cache-write tokens SHALL each be bounded within that request's input total, and total tokens SHALL be at least that request's input plus output. Reasoning tokens SHALL be treated as a subset of output tokens and SHALL NOT be added to output. The aggregate SHALL NOT include usage from compaction or title-generation requests.

#### Scenario: A two-request tool loop sums both requests

- **WHEN** an attempt makes a tool-requesting request reporting 1,000 input, 0 cached, 200 output, and 150 reasoning tokens, then an answer request reporting 1,400 input, 1,000 cached, 100 output, and 60 reasoning tokens
- **THEN** the assistant message usage records 2,400 input, 1,000 cached-input, 300 output, 210 reasoning, and 2,700 total tokens

#### Scenario: A single-request turn is unchanged

- **WHEN** an attempt answers with one model request and no tool call
- **THEN** the assistant message usage equals that request's normalized usage

#### Scenario: Cache subsets stay bounded per request

- **WHEN** one request of a loop reports cached-input plus cache-write tokens exceeding its input total
- **THEN** that request's cache subsets are bounded within its own input total before summing
- **AND** no other request's input absorbs the excess

#### Scenario: Compaction after the turn is not added to the message

- **WHEN** a completed Run triggers compaction and the compaction request reports usage
- **THEN** the assistant message usage is unchanged by the compaction request

### Requirement: Estimated cost prices each request before summing

When the executing model declares `pricingUsdPer1M`, an assistant message's `costUsd` SHALL be the sum of each reported request's cost, each priced under the existing per-request cost rules. When the model declares no pricing, `costUsd` SHALL be `null` whatever usage was reported. A persisted `costUsd` SHALL NOT be recomputed later.

#### Scenario: The two-request loop cost sums both requests

- **WHEN** the two-request loop above runs on a model priced at $2 input, $0.50 cached input, and $10 output per million tokens
- **THEN** the assistant message `costUsd` is 0.0063

#### Scenario: Unpriced model stays unknown

- **WHEN** a multi-request loop runs on a model that declares no `pricingUsdPer1M`
- **THEN** the assistant message `costUsd` is `null`
- **AND** its token counts are still recorded

### Requirement: Usage records its billing mode

Every newly persisted assistant message usage and every newly published compaction usage SHALL carry `billing`, with the value `usage` when the executing model is billed per token and `subscription` when it runs under a flat plan. The value SHALL be resolved when the record is written, in this order: the model entry's `billing` when declared, otherwise the provider entry's `billing` when declared, otherwise `subscription` for `openai-codex` and `opencode-go` providers and `usage` for every other provider type. A persisted `billing` value SHALL NOT be recomputed when configuration later changes. Billing mode SHALL NOT change how tokens or `costUsd` are computed.

#### Scenario: A subscription provider defaults to subscription

- **WHEN** a Run completes on an `openai-codex` or `opencode-go` model that declares no `billing` and whose provider declares none
- **THEN** the assistant message usage records `billing: "subscription"`

#### Scenario: A metered provider defaults to usage

- **WHEN** a Run completes on an `openai-responses`, `openai-completions`, or `anthropic-messages` model with no `billing` declared on the model or its provider
- **THEN** the assistant message usage records `billing: "usage"`

#### Scenario: The provider declaration overrides the type default

- **WHEN** an `openai-completions` provider serving a subscription gateway declares `billing: "subscription"` and its model declares none
- **THEN** the assistant message usage records `billing: "subscription"`

#### Scenario: The model declaration overrides the provider

- **WHEN** a model declares `billing: "usage"` under a provider that declares or defaults to `subscription`
- **THEN** the assistant message usage records `billing: "usage"`

#### Scenario: A priced subscription model still records its cost

- **WHEN** a subscription model declares `pricingUsdPer1M` and a Run completes on it
- **THEN** the assistant message usage records `billing: "subscription"` and the same `costUsd` a metered model at those rates would record

#### Scenario: A configuration change does not relabel history

- **WHEN** an operator changes a provider's `billing` after Runs completed on it
- **THEN** those Runs' persisted usage keeps the `billing` value recorded when it was written

#### Scenario: A compaction records the billing mode of its model

- **WHEN** a compaction publishes using a model whose resolved billing mode is `subscription`
- **THEN** the compaction's usage records `billing: "subscription"`

### Requirement: Usage records whether it is complete

Every newly persisted assistant message usage SHALL carry a boolean `complete`. It SHALL be `false` when any of the following holds, and `true` otherwise:

- a model request of the attempt completed without reporting an input or an output token count;
- the attempt ended failed, cancelled, or expired, whether or not a model request was in flight;
- another attempt of the same Run reached prompt preparation.

A model request reports its usage when the provider delivers that request's usage, whether or not the tools it requested have finished. An incomplete aggregate SHALL keep the known tokens and cost of the requests that did report, as a lower bound. When no request of the attempt reported any input or output count, the token fields and `costUsd` SHALL be absent rather than zero; a model without configured pricing still records `costUsd: null`. Missing cache detail counts SHALL be treated as zero under the existing provider rules and SHALL NOT by themselves mark usage incomplete.

#### Scenario: Every request reported

- **WHEN** every model request of a completed attempt reported input and output counts and no other attempt of the Run reached prompt preparation
- **THEN** the persisted usage records `complete: true`

#### Scenario: A request omitted its counts

- **WHEN** one request of a loop completed without an output token count and the others reported counts
- **THEN** the persisted usage sums the reported counts
- **AND** records `complete: false`

#### Scenario: Nothing was reported

- **WHEN** no model request of an attempt on a priced model reported input or output counts
- **THEN** the persisted usage has no token fields and no `costUsd`
- **AND** records `complete: false`

#### Scenario: A reclaimed Run is incomplete

- **WHEN** an attempt settles a Run for which a different attempt had reached prompt preparation
- **THEN** the persisted usage records `complete: false`

#### Scenario: A reclaim before any preparation stays complete

- **WHEN** an earlier attempt was reclaimed before reaching prompt preparation and the settling attempt's requests all reported counts
- **THEN** the persisted usage records `complete: true`

#### Scenario: Another Run's attempts do not affect completeness

- **WHEN** a different Run, of the same or another owner, has prompt receipts from several attempts
- **THEN** those receipts do not mark the settling Run's usage incomplete

### Requirement: Reasoning tokens are known only when every request reported them

The aggregate `reasoningTokens` SHALL be the sum of every request's reported reasoning count when every model request of the attempt reported one, and SHALL be absent otherwise. A missing reasoning count SHALL NOT be recorded as zero and SHALL NOT by itself mark usage incomplete.

#### Scenario: A model that reports no reasoning

- **WHEN** no request of a completed attempt reported a reasoning count
- **THEN** the persisted usage has no `reasoningTokens`
- **AND** its `complete` value is decided only by the input/output and attempt rules

#### Scenario: Mixed reasoning reports

- **WHEN** one request reported a reasoning count and another did not
- **THEN** the persisted usage has no `reasoningTokens`

### Requirement: Every terminal assistant turn keeps its known usage

When a Run ends failed, cancelled, or expired after at least one model request started, including a cancellation that settles while a tool call is still open, the persisted assistant message usage SHALL contain the aggregate of the requests that reported before the Run ended, with `complete: false`, and SHALL carry the executing `modelId`, the recorded effort when present, the attempt's latency, and its terminal status. It SHALL NOT record zero tokens or zero cost for requests that did not report. A Run that ends before its first model request records no usage, as today. A later settlement attempt SHALL NOT overwrite usage already persisted for the Run's assistant message.

#### Scenario: A failure after a completed tool request

- **WHEN** an attempt completes a reported tool-requesting request and then fails during the next request
- **THEN** the assistant message usage records the first request's tokens and cost
- **AND** records `complete: false` and a failed status

#### Scenario: Cancellation with an open tool call

- **WHEN** an owner cancels a Run while a tool call requested by a model request whose usage the provider already delivered is still open
- **THEN** the cancelled assistant message usage records that request's tokens, cost, `modelId`, and latency
- **AND** records `complete: false`

#### Scenario: Failure before any report

- **WHEN** an attempt on a priced model fails during its first model request
- **THEN** the assistant message usage has no token fields and no `costUsd`
- **AND** still records `modelId`, latency, status, and `complete: false`

### Requirement: Live and reloaded usage agree

Every terminal path that persists an assistant message SHALL also publish that message's usage through the Run event stream before the Run's terminal event, so a subscriber observes the same token counts, cost, reasoning presence, `complete` value, and `billing` value that a later history read returns. Replaying the event stream after reconnect SHALL NOT change or accumulate the displayed usage.

#### Scenario: A failed Run shows usage live

- **WHEN** a subscriber watches a Run that fails after a reported request
- **THEN** the stream delivers the assistant message's usage before the failure event
- **AND** it equals the usage returned when the Chat history is reloaded

#### Scenario: Reconnect replays usage without doubling

- **WHEN** a subscriber reconnects and the stream replays the Run's usage event
- **THEN** the displayed usage equals the persisted usage rather than a multiple of it

### Requirement: Compaction uses the final request's size, not the aggregate

The compaction trigger for a completed Run SHALL use the final completed model request's reported input plus output tokens as its measured context size, independent of the assistant message aggregate. When that request reported no input or output count, the trigger SHALL fall back to the existing estimate. Failed, cancelled, and expired Runs SHALL NOT trigger compaction.

#### Scenario: A long loop over a small context does not compact

- **WHEN** a completed attempt makes many requests whose summed tokens exceed the compaction threshold while its final request's input plus output stays below it
- **THEN** no compaction is triggered by that Run

#### Scenario: A final request above the threshold compacts

- **WHEN** a completed attempt's final request reports input plus output above the compaction threshold
- **THEN** compaction is evaluated exactly as for a single-request turn of that size

### Requirement: Historical usage is marked, never recomputed

Assistant message usage persisted before this capability SHALL have `complete: false` recorded when the message has tool-call parts or its recorded status is not `completed`, and SHALL otherwise have `complete: true` recorded. No existing token, cost, reasoning, model, or status value SHALL change, and no `billing` value SHALL be added to historical assistant or compaction usage. Messages without usage SHALL remain without usage. Applying the marker again SHALL change nothing.

#### Scenario: A historical tool loop is marked incomplete

- **WHEN** a historical assistant message has tool-call parts and recorded usage
- **THEN** its usage records `complete: false`
- **AND** its tokens and `costUsd` are byte-for-byte unchanged

#### Scenario: A historical single-request answer is complete

- **WHEN** a historical completed assistant message has no tool-call parts
- **THEN** its usage records `complete: true`

#### Scenario: A message without usage stays without usage

- **WHEN** a historical assistant message has no usage
- **THEN** it still has no usage after the marker is applied

### Requirement: The owner's usage display distinguishes lower bounds and unknowns

The owner-facing usage display SHALL mark token totals and cost of incomplete usage as lower bounds and SHALL state that some model requests reported no usage. It SHALL present reasoning tokens as a subset of output tokens. It SHALL show an unknown value as unavailable rather than as zero, and SHALL keep unpriced cost distinguishable from zero cost.

#### Scenario: Incomplete usage is shown as a lower bound

- **WHEN** an owner views an assistant message whose usage records `complete: false` with 2,700 total tokens and cost 0.0063
- **THEN** the display shows the total and the cost as at least those values
- **AND** explains that some model requests reported no usage

#### Scenario: Unknown reasoning is not shown as zero

- **WHEN** an owner views usage without `reasoningTokens`
- **THEN** reasoning is shown as unavailable under output, not as 0

#### Scenario: Complete usage is shown exactly

- **WHEN** an owner views usage that records `complete: true`
- **THEN** totals and cost are shown without a lower-bound marker

### Requirement: The owner's usage display marks subscription cost as notional

When usage records `billing: "subscription"` and a cost, the owner-facing usage display SHALL present that cost muted and struck through, labeled as a notional cost, and SHALL expose to assistive technology that the cost was not billed. Usage that records `billing: "usage"` or no `billing` SHALL present its cost as before. A lower-bound marker for incomplete usage SHALL apply to a notional cost as it does to a billed one.

#### Scenario: Subscription cost is shown as notional

- **WHEN** an owner views usage that records `billing: "subscription"` and `costUsd` 0.0063
- **THEN** the cost is shown muted and struck through with a notional-cost label
- **AND** its accessible name states that it was not billed

#### Scenario: Metered and historical cost are unchanged

- **WHEN** an owner views usage that records `billing: "usage"`, or usage with no `billing`
- **THEN** the cost is shown as an ordinary estimated cost

#### Scenario: An unpriced subscription model shows no cost

- **WHEN** an owner views usage that records `billing: "subscription"` and `costUsd: null`
- **THEN** no cost figure is shown, as for any unpriced model

### Requirement: Compaction and title spend stay separate categories

Assistant message usage SHALL cover only the Run's own model requests. A published compaction's usage SHALL remain a single-request receipt on that compaction's own record. Compaction requests that publish no checkpoint and title-generation requests are not recorded by this capability.

#### Scenario: A compaction keeps its own receipt

- **WHEN** a compaction publishes after a completed Run
- **THEN** its usage is recorded on the compaction's own record as that one request's usage
- **AND** the triggering assistant message's usage does not change
