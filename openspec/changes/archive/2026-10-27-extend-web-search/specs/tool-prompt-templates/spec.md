# Spec Delta

## ADDED Requirements

### Requirement: Templates can iterate the configured web search engines

Both template kinds MUST accept `webSearch.engines` as an `each` collection. Its items MUST be the configured web search engines in configuration order. Each item MUST declare only the fields `id`, `type`, `kind`, `position`, `recency`, `queryLimit`, `objective`, and `description`. The worker MUST resolve the collection once at boot, and MUST tag-neutralize each value. `webSearch` MUST be absent when the configuration has no `webSearch` section.

#### Scenario: A template lists the engines

- **WHEN** a template wraps an `each` block over `webSearch.engines` and references `id` and `description` inside it
- **THEN** the block renders once for each configured engine in configuration order
- **AND** startup succeeds

#### Scenario: An undeclared engine field fails startup

- **WHEN** a template references `key` inside an `each` body over `webSearch.engines`
- **THEN** startup fails and names the offending construct
- **AND** no engine key gets into a prompt

#### Scenario: A template without web search configuration

- **WHEN** the configuration has no `webSearch` section and a template wraps a region in `{{#if webSearch}}`
- **THEN** the region renders empty
