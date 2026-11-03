# subscription-access-openai-codex

## Purpose

Enable a personal operator's ChatGPT/Codex subscription as a system model provider while llame retains durable execution and owner isolation.

## Requirements

### Requirement: Fixed direct inference transport

The system SHALL execute `openai-codex` models against `https://chatgpt.com/backend-api/codex/responses` using the configured bearer token and account ID, streaming Responses with provider storage disabled. It SHALL reject redirects and SHALL NOT fall back to another provider, paid API, or provider-owned executor.

#### Scenario: Operator-chosen provider identity

- **WHEN** a configured Codex model is selected under any valid operator-chosen provider ID
- **THEN** execution uses the Codex transport and the model's configured provider model ID
- **AND** catalog responses expose only existing public model metadata, never connection or account details

#### Scenario: Redirect response

- **WHEN** the endpoint returns a redirect
- **THEN** the request fails without sending credentials to the redirect destination

### Requirement: External credential lifecycle

The system SHALL use startup credential snapshots without llame-managed login, refresh, credential writes, or runtime reload. Invalid configuration SHALL fail startup under the instance configuration contract. Structurally valid but rejected credentials SHALL fail at request time. Recovery SHALL require operator reauthentication and restart of API and worker processes before manual retry.

#### Scenario: Credentials change after startup

- **WHEN** the operator replaces or removes the external credential file
- **THEN** running processes retain their current snapshots until stopped
- **AND** llame neither modifies the file nor refreshes credentials

#### Scenario: Authentication failure during a Run

- **WHEN** a provider call fails authentication after a tool effect or partial assistant output was recorded
- **THEN** the affected Run fails with a sanitized reauthentication diagnostic
- **AND** recorded parts and effects remain under the existing durability contract
- **AND** no automatic Run restart or authentication retry occurs

### Requirement: Preserve llame execution semantics

The provider MUST keep the effective instructions of llame, its authorized tools,
and the ordered tool calls and results. It MUST keep the condensed reasoning
summaries that the provider returns. It MUST also keep the persisted effort, cancellation, and the
execution bounds. It MUST persist the SDK `reasoningSummary: "auto"` display text
as `reasoning` parts under the `reasoning-output` contract. With those parts, it
MUST persist the opaque provider metadata that the Responses wire returns. This
metadata is the reasoning item id on each part of that item. It also includes the
encrypted reasoning of the item, on the one part to which the adapter attaches
it. The system MUST NOT copy
the encrypted reasoning to the other parts of the item. The provider metadata of
text and tool parts persists under `turn-replay`. All this metadata MUST replay
only to the provider, on requests for the same Chat that the model rule of
`reasoning-output` allows. It MUST NOT reach owner-visible output, markdown
export, search, public shares, logs, telemetry, or errors. Opaque provider state
that is not bound to a persisted part MUST stay transient. The provider MUST
support compaction through the same transport, with the source-model and effort
semantics of compaction. A meaningful request feature that it cannot carry MUST
fail explicitly, and the system MUST NOT discard it silently.

#### Scenario: Authorized multi-step Run

- **WHEN** a model requests an available tool and continues after its result
- **THEN** llame authorizes and executes the tool under the bound owner and Run
- **AND** the continuation uses the ordered result and the prompt and history contract

#### Scenario: Cancel inference

- **WHEN** the owner cancels an active streaming Run
- **THEN** the provider stream stops, and the Run settles under the cancellation and tool-effect rules
- **AND** no replacement Run starts

#### Scenario: Compaction

- **WHEN** a Codex-backed source Run requires compaction
- **THEN** compaction uses the Codex transport and the persisted effort of the source model
- **AND** persisted usage names the model that executed it, under the compaction contract

#### Scenario: Optional title failure

- **WHEN** a configured Codex title call is not supported or fails
- **THEN** the optional title fallback and failure behavior applies, and the completed answer stays valid
- **AND** title requests carry no effort from the Run and never fall back to another provider

#### Scenario: Encrypted reasoning survives with its part

- **WHEN** a Codex-backed Run receives a reasoning summary whose Responses item carries an id and encrypted content
- **THEN** the persisted reasoning part carries them as opaque provider metadata
- **AND** a later request of the same Chat on the same model replays them with the part, and no owner-facing surface shows them

### Requirement: Contain credential and owner data

The system SHALL keep credentials, account IDs, and resolved host paths out of persisted history, message parts, Run records, receipts, errors, owner/public output, model context, logs, and telemetry. Sanitization SHALL occur before any durable write or owner-visible event. Upstream failures SHALL be sanitized without exposing raw response bodies or authorization headers. Startup diagnostics SHALL follow the existing operator interpolation error contract. System catalog visibility SHALL retain the existing authenticated instance policy; it SHALL NOT grant access to another owner's Chats, Runs, or tool data.

#### Scenario: Another owner accesses execution data

- **WHEN** an authenticated second owner attempts to read or mutate the first owner's Chat, Run, or owner-scoped tool data using the same system model
- **THEN** existing datastore authorization denies access without leaking that data

#### Scenario: Upstream error contains secrets

- **WHEN** an upstream failure echoes credential, account, or request details
- **THEN** owner events, persisted errors, logs, and telemetry contain only sanitized diagnostics

### Requirement: Manual model metadata and unknown cost

The system SHALL use the operator-authored catalog without discovery or automatic API-price substitution. When `pricingUsdPer1M` is omitted, it SHALL record available token usage and latency with unknown dollar cost under the existing `costUsd: null` contract. Subscription quota failures SHALL be distinguishable from authentication failures through sanitized diagnostics and SHALL NOT trigger paid fallback.

#### Scenario: Unpriced subscription model

- **WHEN** a configured subscription model without pricing completes a request
- **THEN** available usage and latency are recorded and dollar cost is null rather than zero

#### Scenario: Subscription limit

- **WHEN** the provider rejects inference because of a quota or rate limit
- **THEN** the affected request reports a sanitized limit diagnostic under existing Run failure/retry rules
- **AND** no claim of zero cost or automatic paid fallback is made
