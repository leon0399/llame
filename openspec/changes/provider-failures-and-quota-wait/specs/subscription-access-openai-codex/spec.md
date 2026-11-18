## MODIFIED Requirements

### Requirement: Manual model metadata and unknown cost

The system MUST use the operator-authored catalog without discovery or automatic API-price
substitution. When `pricingUsdPer1M` is omitted, it MUST record available token usage and latency.
The dollar cost then stays unknown under the `costUsd: null` contract. A subscription quota failure
MUST have the failure class `quota_exhausted` or `billing`, and an authentication failure MUST have
the class `auth`. A usage limit with a reset time can make the Run wait, as `quota-wait` defines. A
quota failure MUST NOT trigger a paid fallback.

#### Scenario: Unpriced subscription model

- **WHEN** a configured subscription model without pricing completes a request
- **THEN** available usage and latency are recorded and dollar cost is null rather than zero

#### Scenario: Subscription limit

- **WHEN** the provider rejects inference with `usage_limit_reached` and an `error.resets_at` one day away
- **THEN** the Run enters `awaiting_quota` with that reset time, and its diagnostic stays sanitized
- **AND** no claim of zero cost or automatic paid fallback is made

#### Scenario: A plan without the model

- **WHEN** the provider rejects inference with `usage_not_included`
- **THEN** the Run fails with the failure class `billing`, and it does not wait
