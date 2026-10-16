## MODIFIED Requirements

### Requirement: Tool failure is an observation, not a crash

An uncertain native `edit` or `write` outcome SHALL abort the model execution
signal and settle the Run without further tool steps. Its tool observation SHALL
report `outcome_unknown` unless a known result is already durable.

A live bash or MCP `outcome_unknown` SHALL NOT abort the model execution
signal. It SHALL be recorded, streamed, and visible to the model as a structured
error result that tells the model to inspect the current state before retrying,
and the run SHALL continue. Crash or redelivery recovery that finds a recorded
native or MCP attempt without a durable result remains outside this live path
and keeps its existing terminal settlement.

Ordinary isolated failures retain the continuation behavior below.

A tool that throws, times out, becomes unavailable, dynamically loses its trusted executor, or returns invalid output SHALL produce a structured error result — recorded, streamed, and visible to the model — and the run SHALL continue whenever the failure is isolated to that tool. Tool execution SHALL be bounded by the global `tools.callTimeoutSeconds` (operator config, documented built-in default 120). A trusted per-tool registration MAY only reduce that value and MUST be finite, positive, and no greater than the configured global maximum; an invalid override SHALL fail registration/admission before advertisement. The effective abort signal SHALL be forwarded into the executor and remote transport, and a timed-out MCP request/body SHALL be aborted and cleaned up before the structured timeout result settles. Tool errors SHALL never expose internal stack traces, remote exception bodies, or secrets in the recorded result.

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the serialized result, after secret redaction. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

An image in a tool result SHALL be carried without image bytes, so the cap measures only the
result's text; the display-only `thumbnail` SHALL sit outside the cap and SHALL be recorded
unchanged. Truncation SHALL NOT cut, shorten, or omit the `media` locator of a `media://` image
result: other values SHALL be shrunk and, at the floor, other fields omitted in its place, so a
recorded `media://` image result always names the complete `media://` locator of the image it
carries.

A code-owned tool whose executor is inconsistent with its admitted in-memory id/schema/classification SHALL fail attempt preparation before a provider request. Fresh attempts SHALL resolve from the executing worker's trusted registry; no historical description or template hash SHALL be required. A dynamic source tool that loses its executor, disconnects, or drifts after attempt preparation SHALL instead retain its attempt-local model-facing declaration with an unavailable executor for that Run, so a requested call settles non-fatally without substituting a changed contract.

#### Scenario: Tool error surfaces to the model and the run continues

- **WHEN** an executing tool throws
- **THEN** the model receives a structured error result and may continue

#### Scenario: Live bash unknown continues the Run

- **WHEN** a bash call records `outcome_unknown` while the Run is executing
- **THEN** the model receives that structured error result
- **AND** the model execution signal is not aborted for that unknown
- **AND** the Run continues

#### Scenario: Live MCP unknown continues the Run

- **WHEN** an MCP call records `outcome_unknown` while the Run is executing
- **THEN** the model receives that structured error result
- **AND** the model execution signal is not aborted for that unknown
- **AND** the Run continues

#### Scenario: Uncertain edit or write still aborts

- **WHEN** a native `edit` or `write` outcome is uncertain
- **THEN** the model execution signal is aborted
- **AND** the Run settles without further tool steps
