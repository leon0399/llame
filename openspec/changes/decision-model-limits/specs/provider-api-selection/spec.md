## MODIFIED Requirements

### Requirement: Model routing shares provider accounts

The system SHALL resolve a wire for every chat, embedding, decision, and
rerank model at startup. A model's explicit `wire` SHALL take precedence over
provider-type, kind, and exact-model metadata defaults. An unsupported kind/wire pair
or missing default SHALL fail startup naming that model's `.wire` field.
Routing SHALL NOT infer a vendor from an account's `id` or URL host.

The `openrouter` provider SHALL support all four kinds through one account.
The `openai` provider SHALL default to Responses for chat and OpenAI embeddings
for embeddings; `anthropic` SHALL default to Messages for chat. Explicit wire
profiles SHALL remain available for custom services. OpenCode Zen and Go SHALL
select chat wires by exact provider/model lookup in bundled upstream metadata,
using the model's first declared API. Unknown models and unsupported metadata
protocols SHALL require an explicit supported wire, without prefix inference
or borrowing another provider's model entry. Startup SHALL use the bundled
snapshot without network discovery. Go SHALL remain chat-only, and Zen SHALL
support chat and decisions.
The Codex subscription account SHALL use only its fixed Codex transport, and
no other account SHALL select that transport.

Wire selection SHALL preserve the account destination and protected
credentials. Decision models SHALL choose between the `system-one` and
`openrouter-decisions` wires, and the resolved wire, not the account type,
SHALL select the decision endpoint. `openrouter` SHALL default decisions to
`openrouter-decisions`; every other account that serves decisions SHALL
default to `system-one` where it has a decision default. Every account except
`openai-codex` and `opencode-go` SHALL accept either decision wire as an
explicit override. Startup SHALL NOT probe endpoint availability. A remote
protocol rejection SHALL fail the request without switching wire or account.
Streaming, structured generation, and compaction SHALL use the same resolved
chat wire and its existing option and failure contracts.

#### Scenario: One account serves four model kinds

- **WHEN** chat, embedding, decision, and rerank entries reference one OpenRouter provider
- **THEN** startup resolves Completions, OpenAI embeddings, OpenRouter Decisions, and Cohere rerank wires respectively
- **AND** each request uses that account's credentials and configured destination

#### Scenario: Explicit wire preserves account identity

- **WHEN** a model overrides a provider default with a supported wire for its kind
- **THEN** its requests use the selected wire at the same account base
- **AND** neither the provider id nor an ambient endpoint variable retargets it

#### Scenario: Unknown model requires an explicit wire

- **WHEN** an OpenCode chat model is absent from its provider's metadata and declares no wire, even if its name starts with a known vendor prefix
- **THEN** startup fails naming that model's `.wire` field

#### Scenario: Exact metadata wins over family spelling

- **WHEN** a configured Go `minimax-m3` model declares no wire
- **THEN** its Messages metadata selects the Anthropic Messages wire
- **AND** Go `minimax-m3.1-flash` selects Chat Completions from its own metadata

#### Scenario: Unsupported metadata protocol is not replaced

- **WHEN** a configured model's metadata selects an unimplemented protocol and the model declares no explicit wire
- **THEN** startup rejects the model instead of guessing a supported protocol

#### Scenario: Wrong kind fails before a request

- **WHEN** an embedding model declares the Messages wire
- **THEN** startup rejects the model instead of attempting a provider request

#### Scenario: Go keeps its destination and redirect boundary

- **WHEN** a Go model resolves Responses, Messages, or Completions
- **THEN** its requests use the fixed Go API base
- **AND** redirects are rejected without forwarding account credentials

#### Scenario: Non-chat calls have no invented Chat identity

- **WHEN** an embedding, decision, or rerank request uses shared account headers
- **THEN** static nonempty headers are forwarded
- **AND** headers containing a session placeholder are omitted

#### Scenario: A remote protocol mismatch fails at request time

- **WHEN** a configured endpoint rejects the resolved model wire
- **THEN** the failure follows that wire's existing failure contract
- **AND** the request is not retargeted or retried on another wire

#### Scenario: Two decision models on one account use different routes

- **WHEN** two decision entries reference one `openrouter` account and only the second declares `wire: "system-one"`
- **THEN** startup resolves `openrouter-decisions` for the first and `system-one` for the second
- **AND** both use that account's key and headers
