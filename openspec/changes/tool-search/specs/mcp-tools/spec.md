## ADDED Requirements

### Requirement: Discovery limits are resource guards independent of the declaration budget

The fixed v1 discovery limits (page size, total tool count, byte bounds, nesting depth, retained
declaration bytes, page cap, cursor guard, and the aggregate deadline) SHALL protect the process
while reading a catalog and SHALL remain in force unchanged when the `tool-calling` declaration
budget defers MCP tools. Deferral SHALL change only which bound declarations are sent to the model
on a step; it SHALL NOT read fewer bytes, admit more tools, or relax any discovery limit, and a
discovery that breaches a limit SHALL fail exactly as it does without deferral.

#### Scenario: Deferral does not widen discovery

- **WHEN** a server publishes more tools than the total-count limit and the model's declaration budget would defer them
- **THEN** that server's discovery fails and publishes no catalog exactly as before
- **AND** nothing from that server is discoverable through `tool_search`

#### Scenario: Deferral does not narrow discovery

- **WHEN** a server's admitted catalog is within every discovery limit but exceeds the model's declaration budget
- **THEN** every admitted tool is bound for the Run and reachable through `tool_search`
- **AND** the discovery limits are not consulted when deciding tiers
