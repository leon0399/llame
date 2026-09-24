## ADDED Requirements

### Requirement: Providers and models may declare their billing mode

A `providers[]` entry and a `models[]` entry MAY each declare an optional `billing` key whose value SHALL be exactly `"usage"` (billed per token) or `"subscription"` (a flat plan under which any declared price is notional). Any other value, including a non-string or an interpolation token, SHALL fail startup naming the offending entry and field. The key SHALL be accepted on every provider `type`. It SHALL be server-only and SHALL NOT be returned by `GET /api/v1/models`. Omitting it everywhere SHALL leave startup and existing configurations unchanged; the billing-mode resolution order is owned by `run-usage-accounting`.

#### Scenario: Declared billing modes boot

- **WHEN** a provider entry declares `"billing": "subscription"` and one of its models declares `"billing": "usage"`
- **THEN** startup succeeds

#### Scenario: An unknown billing value fails startup

- **WHEN** a provider or model entry declares `"billing": "free"`
- **THEN** startup fails naming that entry and its `billing` field
- **AND** no partial configuration is applied

#### Scenario: Billing mode is not exposed in the model catalog

- **WHEN** an authenticated caller reads `GET /api/v1/models` for a model whose provider declares `billing`
- **THEN** the response contains no billing field
