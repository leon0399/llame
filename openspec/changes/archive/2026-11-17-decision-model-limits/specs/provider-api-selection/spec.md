## MODIFIED Requirements

### Requirement: Model routing shares provider accounts

The system MUST resolve a wire for every chat, embedding, decision, and rerank
model at startup. A model's explicit `wire` MUST take precedence over the
provider-type, kind, and exact-model metadata defaults. An unsupported kind and
wire pair, or a missing default, MUST fail startup. The message MUST name that
model's `.wire` field. Routing MUST NOT infer a vendor from the `id` or the URL
host of an account.

The `openrouter` provider MUST support all four kinds through one account. The
`openai` provider MUST default to Responses for chat and to OpenAI embeddings
for embeddings. The `anthropic` provider MUST default to Messages for chat.
Explicit wire profiles MUST stay available for custom services. OpenCode Zen and
Go MUST select chat wires by an exact provider and model lookup in bundled
upstream metadata. That lookup MUST use the first API that the model declares.
An unknown model or an unsupported metadata protocol MUST require an explicit
supported wire. Routing MUST NOT infer a wire from a prefix or from the model
entry of another provider. Startup MUST use the bundled snapshot without
network discovery. Go MUST serve chat only, and Zen MUST serve chat and
decisions. The Codex subscription account MUST use only its fixed Codex
transport. Another account MUST NOT select that transport.

Wire selection MUST keep the account destination and the protected credentials.
A decision model MUST use the `system-one` wire or the `openrouter-decisions`
wire. The resolved wire MUST select the decision endpoint, and the account type
MUST NOT select it. The `openrouter` account MUST default decisions to
`openrouter-decisions`. Another account with a decision default MUST default to
`system-one`. Every account except `openai-codex` and `opencode-go` MUST accept
either decision wire as an explicit override. Startup MUST NOT probe endpoint
availability. A remote protocol rejection MUST fail the request, and the system
MUST NOT change the wire or the account. Streaming, structured generation, and
compaction MUST use the same resolved chat wire with its option and failure
contracts.

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
