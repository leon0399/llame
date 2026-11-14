## ADDED Requirements

### Requirement: A cancellation ends a Run that waits

A cancellation of a Run in `awaiting_jobs` MUST wake the Run as `durable-runs` defines. The next
claim MUST settle the Run `cancelled` without a model request. The open `wait` call MUST settle
as `tool-calling` requires for a cancellation. The jobs of the Chat MUST NOT stop.

#### Scenario: The owner cancels a Run that waits

- **WHEN** the owner cancels a Run that waits on a build
- **THEN** the Run becomes `cancelled`, and the `wait` call shows as cancelled
- **AND** the build stays `running`
