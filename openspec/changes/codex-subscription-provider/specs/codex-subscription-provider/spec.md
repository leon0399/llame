## Purpose

Enable a personal operator's ChatGPT/Codex subscription as a system model provider while llame retains durable execution and owner isolation.

## ADDED Requirements

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

The provider SHALL preserve llame's effective instructions, authorized tools, ordered tool calls/results, recorded reasoning display, persisted effort, cancellation, and execution bounds. It SHALL NOT inject peer-agent prompts or add opaque reasoning to persisted history, later Run context, or owner-visible output. It SHALL support compaction through the same transport and existing source-model/effort semantics. Unsupported meaningful request features SHALL fail explicitly rather than being silently discarded.

#### Scenario: Authorized multi-step Run

- **WHEN** a model requests an available tool and continues after its result
- **THEN** llame authorizes and executes the tool under the bound owner and Run
- **AND** the continuation uses the ordered result and existing prompt/history contract

#### Scenario: Cancel inference

- **WHEN** the owner cancels an active streaming Run
- **THEN** provider streaming is aborted and the Run settles under existing cancellation and tool-effect rules
- **AND** no replacement Run is started

#### Scenario: Compaction

- **WHEN** a Codex-backed source Run requires compaction
- **THEN** compaction uses the Codex transport and source model's persisted effort
- **AND** persisted usage identifies the executing model under the existing compaction contract

#### Scenario: Optional title failure

- **WHEN** a configured Codex title call is unsupported or fails
- **THEN** the existing optional title fallback/failure behavior applies without invalidating the completed answer
- **AND** title requests carry no effort inherited from the Run and never fall back to another provider

### Requirement: Contain credential and owner data

The system SHALL keep credentials, account IDs, and resolved host paths out of owner/public output, model context, logs, and telemetry. Upstream failures SHALL be sanitized without exposing raw response bodies or authorization headers. Startup diagnostics SHALL follow the existing operator interpolation error contract. System catalog visibility SHALL retain the existing authenticated instance policy; it SHALL NOT grant access to another owner's Chats, Runs, or tool data.

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
