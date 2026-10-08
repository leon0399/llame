## ADDED Requirements

### Requirement: Available model entries publish their input modalities

Every available model entry SHALL include a required `input` array naming the input modalities the
model accepts, drawn from `text` and `image`. The value SHALL be the model's resolved configured
declaration in its declared order; a model whose configuration omits the declaration SHALL publish
`["text"]`. `input` SHALL NOT be omitted or returned as `null` on any entry, and it SHALL NOT be
inferred from the model `id`, name, provider, or provider execution id.

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
