## MODIFIED Requirements

### Requirement: Tool predicates are absent-safe membership checks

Both template kinds SHALL permit `tools.<exact-id>` as an `if`/`unless`
subject. It SHALL be true exactly for an admitted declaration in the current
attempt's worker catalog, after existing allowlist, classification, capability,
collision, timeout, and schema admission. Every absent id SHALL be false,
including an unknown native tool or unconfigured/undiscovered MCP tool.
Absence SHALL NOT fail boot or initiate discovery.

Validate exact-id syntax and parsed path structure, not registry membership.
Direct value emission, wildcard identity, iteration, bare `tools`, deeper
properties, parent traversal, and prototype traversal SHALL remain invalid.
Predicates SHALL use explicit own boolean values. No additional feature-check
namespace SHALL be introduced. Per-call permission policy SHALL remain separate.

#### Scenario: A shared template mentions an uninstalled tool

- **WHEN** a valid template checks `tools.find` and no find tool is registered
- **THEN** worker startup succeeds and the predicate evaluates false
- **AND** no tool is created or enabled by the reference

#### Scenario: An MCP server is not configured

- **WHEN** a predicate names a syntactically valid exact MCP id with no configured server
- **THEN** validation succeeds and the predicate evaluates false
- **AND** no network lookup is performed

#### Scenario: Tool visibility does not grant invocation permission

- **WHEN** a tool is admitted but every call is rejected by its permission policy
- **THEN** its predicate is true
- **AND** invoking it still produces the existing non-fatal permission rejection

#### Scenario: Predicate cannot expose source objects

- **WHEN** a template emits `{{tools.read}}` or traverses `tools.read.description`
- **THEN** startup fails naming the unsupported construct without prompt contents
