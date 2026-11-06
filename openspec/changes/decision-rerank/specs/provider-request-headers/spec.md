# Spec Delta

## MODIFIED Requirements

### Requirement: Provider types supply default headers under the operator map

Each provider type MUST have a default header map. The map `{ "X-Session-Id": "{session:id}" }` is the default for `openai-responses`, `openai-completions`, `anthropic-messages`, and `opencode-go`. The default map is empty for `openai-codex` and for `system-one`. The effective map MUST be the default map with the operator map laid over it key by key. The system compares names without ASCII letter case. A string value replaces the default value. A `null` value removes a default entry.

#### Scenario: An entry without a map sends the default

- **WHEN** an `openai-completions` entry declares no `headers`
- **THEN** its requests carry `X-Session-Id` rendered from the request's Chat identity

#### Scenario: Null removes a default header

- **WHEN** an `anthropic-messages` entry declares `"headers": { "x-session-id": null }`
- **THEN** its requests carry no `X-Session-Id` header in any letter case

#### Scenario: An operator value replaces a default

- **WHEN** an `openai-responses` entry declares `"headers": { "X-Session-Id": "llame-{session:id}" }`
- **THEN** its requests carry exactly one `X-Session-Id` header with the operator's rendered value

#### Scenario: Codex sends no default header

- **WHEN** an `openai-codex` entry declares no `headers`
- **THEN** its requests carry no `X-Session-Id` and no other header from a default map

#### Scenario: Codex sends the header when the operator adds it

- **WHEN** an `openai-codex` entry declares `"headers": { "X-Session-Id": "{session:id}" }`
- **THEN** its requests carry `X-Session-Id` rendered from the request's Chat identity

#### Scenario: A decision provider sends no default header

- **WHEN** a `system-one` entry declares no `headers`
- **THEN** its requests carry no header from a default map

## ADDED Requirements

### Requirement: A decision provider header cannot name the session

A header value of a `system-one` entry MUST NOT contain `{session:id}`. A decision call has no Chat lane. Startup MUST fail and name the provider id and the header name.

#### Scenario: A decision provider header names the session

- **WHEN** a `system-one` entry declares `"headers": { "X-Tag": "{session:id}" }`
- **THEN** startup fails
- **AND** the message names the provider id and the header `X-Tag`
