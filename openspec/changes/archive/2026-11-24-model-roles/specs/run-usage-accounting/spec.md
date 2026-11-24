## MODIFIED Requirements

### Requirement: Usage records its billing mode

Each new assistant message usage MUST carry `billing`, except the `running` usage that a dispatch
transaction writes on the reply of a Run. Each new compaction usage MUST also carry it. The value is
`usage` for a price for each token and `subscription` for a flat plan. It is `free` for a model that
is never billed.

The system MUST resolve the value when it writes the record, in this order. First comes the `billing`
of the model entry, when declared. Then comes the `billing` of the provider entry, when declared.
Last comes the type default: `subscription` for `openai-codex` and `opencode-go`, and `usage` for each
other provider type.

The system MUST NOT compute a persisted `billing` again when the config changes. The billing mode
MUST NOT change how the system computes tokens or `costUsd`. The `running` usage MUST carry no
`billing`. The terminal usage that replaces it MUST resolve `billing` when the system writes it. This
applies also to a terminal usage with no token counts.

#### Scenario: A subscription provider defaults to subscription

- **WHEN** a Run completes on an `openai-codex` or `opencode-go` model, and neither the model nor its provider declares `billing`
- **THEN** the assistant message usage records `billing: "subscription"`

#### Scenario: A metered provider defaults to usage

- **WHEN** a Run completes on an `openai-responses`, `openai-completions`, or `anthropic-messages` model with no `billing` on the model or its provider
- **THEN** the assistant message usage records `billing: "usage"`

#### Scenario: The provider declaration overrides the type default

- **WHEN** an `openai-completions` provider of a subscription gateway declares `billing: "subscription"`, and its model declares none
- **THEN** the assistant message usage records `billing: "subscription"`

#### Scenario: The model declaration overrides the provider

- **WHEN** a model declares `billing: "usage"` under a provider that declares `subscription` or has it as its default
- **THEN** the assistant message usage records `billing: "usage"`

#### Scenario: A priced subscription model still records its cost

- **WHEN** a subscription model declares `pricingUsdPer1M`, and a Run completes on it
- **THEN** the assistant message usage records `billing: "subscription"` and the `costUsd` that a metered model at those rates records

#### Scenario: A configuration change does not relabel history

- **WHEN** an operator changes the `billing` of a provider after Runs completed on it
- **THEN** the persisted usage of those Runs keeps the `billing` value of its write

#### Scenario: A compaction records the billing mode of its model

- **WHEN** a compaction publishes with a model whose resolved billing mode is `subscription`
- **THEN** the usage of the compaction records `billing: "subscription"`

#### Scenario: A free model records free

- **WHEN** a Run completes on a model that declares `billing: "free"` and `pricingUsdPer1M`
- **THEN** the assistant message usage records `billing: "free"` and the computed `costUsd`

### Requirement: The owner's usage display marks subscription cost as notional

When usage records `billing: "subscription"` or `billing: "free"` and a cost, the owner usage display
MUST show the cost muted and struck through. It MUST label it as a notional cost, and it MUST tell
assistive technology that nobody paid it. Usage with `billing: "usage"` or no `billing` MUST show its
cost as an ordinary estimated cost. The lower-bound marker of incomplete usage MUST apply to a
notional cost as it applies to a billed cost.

#### Scenario: Subscription cost is shown as notional

- **WHEN** an owner views usage that records `billing: "subscription"` and `costUsd` 0.0063
- **THEN** the display shows the cost muted and struck through, with a notional-cost label
- **AND** its accessible name states that nobody paid it

#### Scenario: Metered and historical cost are unchanged

- **WHEN** an owner views usage that records `billing: "usage"`, or usage with no `billing`
- **THEN** the display shows the cost as an ordinary estimated cost

#### Scenario: An unpriced subscription model shows no cost

- **WHEN** an owner views usage that records `billing: "subscription"` and `costUsd: null`
- **THEN** the display shows no cost figure, as for any unpriced model

#### Scenario: A free model shows notional cost

- **WHEN** an owner views usage that records `billing: "free"` and `costUsd` 0.002
- **THEN** the display shows the cost muted and struck through, with a notional-cost label
