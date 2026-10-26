# Spec Delta

## MODIFIED Requirements

### Requirement: llame-owned descriptions are complete file templates

Each registered llame-owned tool MUST have a complete packaged description. Both template kinds MUST share one language, the allowed variables, neutralization, omission, bounded iteration, and one-pass render. Selection MUST follow `instance-config` precedence. A template MUST change only description text, never identity, schemas, parameter descriptions, classification, permissions, or results. `web-search` can append its engine catalog. MCP descriptions MUST stay opaque source-authored text.

#### Scenario: Packaged descriptions cover the registry

- **WHEN** a worker starts without overrides
- **THEN** it loads a complete packaged description for every llame-owned tool
- **AND** its compiled runtime can load those files independently of the source tree

#### Scenario: Both prompt surfaces share variables

- **WHEN** the system prompt and an admitted description reference the same allowed path
- **THEN** they receive the same resolved value and neutralization for that attempt
- **AND** the worker does not evaluate substituted owner text again

#### Scenario: MCP text is not a template

- **WHEN** an MCP description contains `{{user.email}}`
- **THEN** it stays literal text
- **AND** the worker does not substitute owner data into it

#### Scenario: Web search appends its engine catalog

- **WHEN** an attempt declares `web_search` with a packaged or overridden description
- **THEN** the declared description is the rendered template followed by the engine catalog that `web-search` defines
- **AND** the template file stays complete without the catalog
