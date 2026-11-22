## MODIFIED Requirements

### Requirement: A head result names the artifact in its cap notice

When a `head` result spills, its cap notice MUST name the artifact and its
line count. It MUST also name `<locator>:L1-` in the canonical selector
spelling, and its host files when they exist. The notice MUST still state that narrower arguments recover
the omitted content.

#### Scenario: A spilled MCP result names its artifact

- **WHEN** an MCP result of 900 lines of JSON spills to `artifact://mcp__docs__fetch-4`
- **THEN** the cap notice names `artifact://mcp__docs__fetch-4`, 900 lines, and `artifact://mcp__docs__fetch-4:L1-`
