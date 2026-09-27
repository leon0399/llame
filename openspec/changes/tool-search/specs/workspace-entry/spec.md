## ADDED Requirements

### Requirement: Entry results disclose Workspace tools made discoverable

When a successful `enter_workspace` adds MCP declarations that the `tool-calling` partition makes
discoverable, its result SHALL list each such tool id and SHALL state that those tools load
through `tool_search` before they can be called. A result SHALL NOT list declared additions as
discoverable, and SHALL list no id the attempt did not admit. Ids SHALL be the admitted canonical
MCP ids; server-authored descriptions SHALL NOT be copied into the result.

#### Scenario: Entry beyond the budget names discoverable tools

- **WHEN** entry adds a Workspace server whose tools engage deferral
- **THEN** the result lists each discoverable addition by id and says it loads through `tool_search`

#### Scenario: Entry within the budget lists no discoverable tools

- **WHEN** entry adds Workspace tools that all fit the budget
- **THEN** the result lists no discoverable tools
