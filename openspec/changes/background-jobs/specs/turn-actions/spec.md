## ADDED Requirements

### Requirement: A turn that a host message started accepts follow-up Runs

A host message of `background-jobs` that has a Run MUST accept a follow-up Run under the rules
for a user message. The request MUST name the id of the host message. A Continue or a Regenerate
of that turn MUST keep the host message and its `job` context items.

#### Scenario: A Continue after a host-started Run failed

- **WHEN** a notice starts a Run, the Run fails, and the owner chooses Continue
- **THEN** the Continue Run starts on the host message, and its first request carries the same `job` context item
