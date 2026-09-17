## MODIFIED Requirements

### Requirement: Provider execution resolves through the configured provider

Model execution SHALL resolve a run's model to its catalog entry, that entry's `provider` to the matching `providers[]` entry, and a model client selected by the provider's `type`. The implementation SHALL dispatch on `type` — each executable type maps to exactly one client, and the wire that client speaks is specified by `provider-api-selection` — and SHALL treat any unrecognized resolved `type` as an internal error, not a silent fallback. Provider credentials and base URL SHALL come from the resolved provider entry, not from a fixed environment variable. A keyless provider (empty resolved `key`) SHALL execute against its configured endpoint without raising a missing-credential error at client construction.

#### Scenario: Model routes to its provider's client

- **WHEN** a worker executes a run whose stored model id resolves to a catalog entry with `provider: "p"` and `providers[].id "p"` has an executable `type`
- **THEN** it builds the client for that `type` using provider `p`'s `key`/`baseUrl`
- **AND** it does not read `OPENAI_API_KEY` or `OPENAI_BASE_URL` as bare environment variables

#### Scenario: Keyless provider executes

- **WHEN** a run's model resolves to a keyless provider (empty `key`, e.g. a local Ollama declared `openai-completions`)
- **THEN** the model client is constructed without raising `LoadAPIKeyError`
- **AND** provider auth/reachability failures still surface at provider request time, not at construction

#### Scenario: Two providers of the same type route independently

- **WHEN** two models name two distinct providers of the same executable `type`
- **THEN** each executes against its own provider's `key`/`baseUrl`
