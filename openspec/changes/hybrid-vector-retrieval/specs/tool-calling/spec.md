## MODIFIED Requirements

### Requirement: Tool failure is an observation, not a crash

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 120). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result.

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the serialized result, after secret redaction. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

A code-owned tool whose trusted executor is missing or incompatible, or whose live declaration no longer matches its immutable snapshot, SHALL remain a context-integrity failure for the Run before any provider request. A dynamic source tool that loses its executor, disconnects, or drifts after enqueue SHALL instead retain its snapshotted model-facing declaration with an unavailable executor for that Run, so a requested call settles non-fatally without substituting a changed contract.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** an error result part is recorded, the model observes it, and the run proceeds to a final answer

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout
- **THEN** execution and any remote request/body are aborted and cleaned up
- **AND** a structured timeout error result is recorded and the run continues

#### Scenario: Invalid trusted timeout override fails admission

- **WHEN** a trusted tool registers a non-finite, non-positive, or above-global timeout override
- **THEN** registration or admission fails before the tool is advertised

#### Scenario: Dynamic executor disappears after enqueue

- **WHEN** a dynamic tool was bound into a Run snapshot but its source disconnects before the model requests it
- **THEN** the call settles as structured `not_available`, no substitute executes, and the Run continues

#### Scenario: Code-owned declaration drift remains fail-closed

- **WHEN** a snapshotted code-owned tool no longer canonically matches its live trusted declaration
- **THEN** the Run fails before the provider request rather than executing a different contract

#### Scenario: Code-owned executor loss remains fail-closed

- **WHEN** a snapshotted code-owned tool has no compatible trusted executor at execution
- **THEN** the Run fails before the provider request rather than returning a dynamic unavailability observation

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a safe message, not a stack trace, raw remote error, or configuration value

#### Scenario: Truncated success result keeps its declared shape

- **WHEN** a successful result serializes above the cap
- **THEN** the recorded result keeps `status: "success"` and every top-level field the tool returned, with oversized values shrunk in place rather than replaced by a serialized fragment of the result

#### Scenario: Truncation cuts on a code-point boundary

- **WHEN** the cut point of an oversized string value falls between the halves of a surrogate pair
- **THEN** the truncated value is well-formed and contains no lone surrogate

#### Scenario: Truncation marker states omission and recovery

- **WHEN** a result is truncated
- **THEN** it carries a marker stating the number of omitted characters and that narrowing the call's arguments recovers the omitted content

#### Scenario: Cap outranks declared shape at the floor

- **WHEN** a successful result's top-level field names alone serialize above the cap
- **THEN** trailing fields are omitted so the recorded result still fits the cap
- **AND** the marker states how many fields of how many were omitted entirely

#### Scenario: Shortened list reports what survived

- **WHEN** truncation drops the tail of a list in the payload
- **THEN** the marker names that list and states how many elements were kept of how many it held
- **AND** when more lists were shortened than the marker names, the remainder is counted rather than named

#### Scenario: Error results are never truncated

- **WHEN** a structured error result is produced
- **THEN** it is recorded unchanged regardless of length
