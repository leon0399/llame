## ADDED Requirements

### Requirement: Available model entries publish their input modalities

An entry's `input` SHALL name the input modalities the model accepts, drawn only from `text` and
`image`. It SHALL be the model's resolved configured declaration in its declared order, and it SHALL
NOT be inferred from the model `id`, name, provider, or provider execution id.

#### Scenario: Declared image input is published

- **WHEN** a model entry configures `input: ["text", "image"]` and an authenticated caller requests
  `GET /api/v1/models`
- **THEN** that model's entry includes `input` equal to `["text", "image"]`

#### Scenario: Undeclared input is published as text only

- **WHEN** a model entry omits `input` and an authenticated caller requests `GET /api/v1/models`
- **THEN** that model's entry includes `input` equal to `["text"]`
- **AND** the field is neither omitted nor `null`

#### Scenario: Every returned entry carries input

- **WHEN** `GET /api/v1/models` returns several models, some declaring `input` and some not
- **THEN** every returned entry includes a non-empty `input` array containing `text`

## MODIFIED Requirements

### Requirement: Available model entries use opaque ids and rich display metadata

Each available model entry SHALL include an opaque API `id`, a `source` enum value, and best-effort rich display metadata. Clients SHALL treat `id` as opaque and SHALL NOT parse provider routing semantics from it. The API response SHALL NOT expose provider execution ids unless a future requirement needs them.

Internal system model catalog entries SHALL explicitly configure the provider execution id used by the adapter. The implementation SHALL NOT derive a provider execution id by parsing, splitting, or stripping the llame model `id`.

Per model entry, `id`, `source`, `contextWindowTokens`, and `input` SHALL be required. `contextWindowTokens` is execution-critical — it sizes the context-compaction trigger — and SHALL therefore be part of the model contract at every layer (internal catalog, API response, and future org/group/user sources), not optional display metadata. `input` SHALL be `["text"]` when a model's configuration omits it, and SHALL NOT be omitted or returned as `null`. All other metadata SHALL remain optional and SHALL NOT affect model executability; missing optional metadata, including `name`, SHALL NOT make model configuration invalid. Unknown optional metadata SHALL be omitted from JSON rather than returned as `null`; `null` is reserved for fields with explicit domain-level null semantics.

#### Scenario: System model entry

- **WHEN** a system model is returned
- **THEN** its entry includes `source = "system"`, an opaque `id`, and the known display metadata for that model

#### Scenario: Provider execution id is explicit server-side config

- **WHEN** the API resolves a system model for execution
- **THEN** it uses the catalog entry's explicit server-only provider execution id
- **AND** it does not derive that provider execution id from the llame model `id`

#### Scenario: Context window is required

- **WHEN** any executable model is returned by `GET /api/v1/models`
- **THEN** its entry includes a positive `contextWindowTokens`
- **AND** the same value sizes the context-compaction trigger for runs on that model
- **AND** a model with no configured context window is a configuration error, not an executable entry with omitted metadata

#### Scenario: Optional metadata is absent rather than fabricated

- **WHEN** a display field such as description, pricing, dates, or links is unknown
- **THEN** the field is omitted rather than guessed or returned as `null`

#### Scenario: Name is optional

- **WHEN** a returned model does not include `name`
- **THEN** clients use the opaque `id` as the deterministic display fallback

#### Scenario: Missing display metadata does not disable execution

- **WHEN** a hardcoded model has valid execution configuration but omits optional display metadata
- **THEN** the model can still be returned by `GET /api/v1/models` and accepted as chat `modelId`
- **AND** model configuration is not invalidated by the missing display metadata

#### Scenario: Pricing units are explicit

- **WHEN** pricing metadata is returned
- **THEN** it is represented with explicit units under `pricingUsdPer1M`, not ambiguous per-token field names
