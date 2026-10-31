# Spec Delta

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

Oversized tool results SHALL be truncated to a documented cap, measured in JavaScript UTF-16 code units over the model-facing rendering of the result, after secret redaction; `tool-result-rendering` defines that rendering as the serialized result for a JSON-rendered tool and the text shape for a text-rendered tool. The stored `display` object MUST NOT count toward the cap, and text the rendering builds from its values MUST count. Truncation SHALL operate on the tool's own payload rather than on the result envelope: the `status` discriminant and every top-level field the tool declared SHALL survive, with values shrunk in place. Where the declared field names alone exceed the cap, the cap SHALL win over the declared shape — trailing fields SHALL be omitted and the marker SHALL state how many of how many — so a result above the cap is never emitted. A string value SHALL be cut only on a Unicode code-point boundary, so no truncated payload contains a lone surrogate. Truncation SHALL NOT re-serialize any part of the payload into a string field, so redaction performed before truncation cannot be defeated by an alternate typed representation. A truncated result SHALL carry one visible truncation marker stating how many characters were omitted and the recovery action available to the model. When truncation shortens a list, the marker SHALL also state how many elements of that list survived out of how many it held, naming the lists that lost the most and counting any remainder, so a count read off a shortened list is not mistaken for a complete one. Error results SHALL NOT be truncated, because every error message this loop produces is a short, statically authored string.

An image in a tool result SHALL be carried without image bytes, so the cap measures only the
result's model-facing rendering; the stored `display.thumbnail` SHALL sit outside the cap and
SHALL be recorded unchanged. Truncation SHALL NOT cut, shorten, or omit the `media` locator of a
`media://` image result: other values SHALL be shrunk and, at the floor, other fields omitted in
its place, so a recorded `media://` image result always names the complete `media://` locator of
the image it carries.

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

#### Scenario: Tool call times out

- **WHEN** a tool exceeds its effective timeout
- **THEN** execution and any remote request/body are aborted and cleaned up
- **AND** a structured timeout error result is recorded and the run continues

#### Scenario: Invalid trusted timeout override fails admission

- **WHEN** a trusted tool registers a non-finite, non-positive, or above-global timeout override
- **THEN** registration or admission fails before the tool is advertised

#### Scenario: Dynamic executor disappears after enqueue

- **WHEN** a dynamic tool was bound into an attempt but its source disconnects before the model requests it
- **THEN** the call settles as structured `not_available`, no substitute executes, and the Run continues

#### Scenario: Code-owned declaration drift remains fail-closed

- **WHEN** a prepared code-owned declaration has an id/schema inconsistent with its trusted attempt-local executor
- **THEN** the Run fails before the provider request rather than executing a different contract

#### Scenario: Code-owned executor loss remains fail-closed

- **WHEN** a prepared code-owned tool has no compatible trusted executor at execution
- **THEN** the Run fails before the provider request rather than returning a dynamic unavailability observation

#### Scenario: Error results carry no internals

- **WHEN** a tool error result is recorded
- **THEN** it contains a safe message, not a stack trace, raw remote error, or configuration value

#### Scenario: Truncated success result keeps its declared shape

- **WHEN** a successful result renders above the cap
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

#### Scenario: Permission rejection is a non-fatal tool observation

- **WHEN** the execution policy rejects an otherwise valid available tool call
- **THEN** no tool executor or native effect attempt starts
- **AND** the model receives `permission_denied` and may continue within existing Run limits
- **AND** the system neither retries the rejected call automatically nor requests approval

#### Scenario: Truncation keeps an image result's media reference

- **WHEN** a `media://` image result serializes above the cap because another field is oversized
- **THEN** the recorded result carries the complete `media://` locator unchanged
- **AND** the oversized field is shrunk in place and the marker states the omitted characters

#### Scenario: The floor omits other fields before the media reference

- **WHEN** a `media://` image result's top-level field names alone serialize above the cap
- **THEN** fields other than the one carrying the media reference are omitted until the result fits
- **AND** the recorded result still carries the complete `media://` locator

#### Scenario: A thumbnail does not count toward the cap

- **WHEN** an image result's rendering fits the cap and its `display.thumbnail` would exceed it
  were it counted
- **THEN** the result is recorded without truncation
- **AND** its `display.thumbnail` is recorded unchanged

### Requirement: Framing llame authors inside tool results is a packaged template

The untrusted-output framing that wraps every tool result presented to a model MUST be a packaged template file. So MUST each closed notice llame places inside a tool result: the prior-conversation notice of `conversation-reads`, the search-excerpt notice of `chat-search`, the Knowledge content notice of `knowledge-tools`, and the path instruction of `agent-skills`. The module that authors the text owns the file, and the executing process ships it. The template renders under the producer-owned-values rule `context-injection` defines for item bodies. These templates MUST NOT be operator configuration: no configuration key can select, replace, or disable one. The rendered framing and notice bytes MUST stay identical to the previous inline text. The payload inside the framing MUST be the rendering and neutralization that `tool-result-rendering` defines; the framing itself MUST NOT apply a second neutralization pass.

Result content composed by a tool implementation, the permission layer, or result truncation is not framing and remains outside this requirement. That content includes error messages, permission rejections, and settlement and truncation notices.

#### Scenario: Wrapped tool output is unchanged by the template migration

- **WHEN** a tool result is presented to a model after this change
- **THEN** its untrusted-output framing and outcome line are byte-identical to the previous inline composition
- **AND** the payload block is the rendering that `tool-result-rendering` defines, neutralized once

#### Scenario: A result notice is unchanged by the template migration

- **WHEN** a conversation read, search, Knowledge read, or skill read returns its closed notice after this change
- **THEN** the notice text is byte-identical to the previous inline constant
- **AND** the capability that owns the notice still observes its content obligations

#### Scenario: No configuration replaces a result notice

- **WHEN** an operator configuration attempts to name a replacement for a result notice or the output framing
- **THEN** startup rejects the unknown key under the closed schema
- **AND** the packaged template remains in use
