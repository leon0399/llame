## ADDED Requirements

### Requirement: Tool search is evaluated without a permission group

The harness-synthesized `tool_search` tool (`tool-calling`) SHALL execute without matching a
`tools.permissions` group and SHALL be the only tool exempt from the rule that an absent group
rejects. The exemption SHALL NOT extend to any tool that `tool_search` loads: each call to a
loaded tool SHALL be evaluated against that tool's own group exactly as a declared tool's call is.
Configuration that names `tool_search` as a permission group key SHALL be accepted and SHALL
never match, like any other key that names no configurable tool.

#### Scenario: Search runs with no configured group

- **WHEN** `tools.permissions` has no `tool_search` group and the model calls `tool_search`
- **THEN** the search executes and records no permission decision

#### Scenario: A loaded tool is still gated

- **WHEN** `tool_search` loads an MCP tool whose permission group rejects the submitted arguments
- **THEN** the call to that tool is rejected as `permission_denied` and produces no effect

#### Scenario: A configured tool_search group has no effect

- **WHEN** an operator configures a `tool_search` group that rejects every call
- **THEN** startup succeeds and `tool_search` calls still execute
