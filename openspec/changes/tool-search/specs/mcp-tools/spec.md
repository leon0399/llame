## ADDED Requirements

### Requirement: Discovery limits are resource guards independent of the declaration budget

The fixed v1 discovery limits (page size, total tool count, byte bounds, nesting depth, retained
declaration bytes, page cap, cursor guard, and the aggregate deadline) SHALL protect the process
while reading an operator or Workspace server's catalog and SHALL remain in force unchanged when
the `tool-calling` declaration
budget makes MCP tools discoverable. Deferral SHALL change only which admitted declarations are
offered to the model on a step; it SHALL NOT read fewer bytes, admit more tools, or relax any
discovery limit, and a discovery that breaches a limit SHALL fail exactly as it does without
deferral.

#### Scenario: Deferral does not widen discovery

- **WHEN** a server publishes more tools than the total-count limit and the model's declaration budget would defer them
- **THEN** that server's discovery fails and publishes no catalog exactly as before
- **AND** nothing from that server is discoverable through `search_tools`

#### Scenario: Deferral does not narrow discovery

- **WHEN** a server's admitted catalog is within every discovery limit but exceeds the model's declaration budget
- **THEN** every admitted tool stays admitted for the attempt, either declared, reachable through `search_tools`, or recorded `unavailable` with the closed reason `declaration_budget_exceeded`
- **AND** the discovery limits are not consulted when deciding tiers
