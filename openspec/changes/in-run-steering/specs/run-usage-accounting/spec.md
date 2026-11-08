## MODIFIED Requirements

### Requirement: Usage records whether it is complete

Every newly persisted assistant message usage MUST carry a boolean `complete`. The first dispatch
transaction of an attempt creates or resets the reply to the message of the Run. That reply MUST
carry the `running` usage `{ status: 'running', complete: false, runId, attemptId, modelId,
effort, permissionMode }`. The usage omits `effort` when the Run has none. It holds
`permissionMode: 'bypass'` only when the effective mode of the attempt is `bypass`. A later
attempt for the same message resets it with its own `attemptId` and effective mode. `running`
MUST exist only on such a reply. It MUST count as non-completed everywhere. It MUST carry no
token, cost, latency, measured-size, or `billing` field. The field rules of this capability apply
to the terminal usage that replaces it.

Every finalizer of the reply MUST replace the `running` usage with a terminal status (`completed`,
`error`, or `aborted`) and the `complete` value below. A terminal usage MUST be `false` when one
or more of these conditions are true, and `true` otherwise:

- a model request of the attempt completed without an input or an output token count;
- the attempt ended failed, cancelled, or expired, with or without a model request in flight;
- the recorded terminal status of the Run is not `completed` when the usage is written, and no
  steer delivery of `run-steering` closed the reply;
- another attempt for the same message of the Run reached prompt preparation;
- the usage replaces the usage of an earlier assistant reply to the same user message, and the
  earlier spend is not carried forward. The `running` usage of the Run itself is not an earlier
  reply for this rule.

A model request reports its usage when the provider delivers the usage of that request. The tools
that it requested do not have to be finished. An incomplete aggregate MUST keep the known tokens
and cost of the requests that reported, as a lower bound. When no request of the attempt reported
an input or output count, the token fields MUST be absent, not zero. `costUsd` follows pricing
first. A model without configured pricing MUST record `costUsd: null` in every case. A priced
model MUST omit `costUsd` only when no request reported an input or output count. Absent cache
detail counts MUST count as zero under the provider rules of today. They MUST NOT by themselves
mark usage incomplete.

#### Scenario: Every request reported

- **WHEN** every model request of a completed attempt reported input and output counts
- **AND** no other attempt for the same message of the Run reached prompt preparation
- **THEN** the persisted usage records `complete: true`

#### Scenario: A late completion under an expired Run is incomplete

- **WHEN** the final request of an attempt completes after the Run was recorded as expired
- **AND** its usage is still persisted
- **THEN** the persisted usage records `complete: false`

#### Scenario: A replacement reply is incomplete

- **WHEN** a later assistant turn replaces an earlier, non-completed reply to the same user message
- **AND** that reply had recorded usage
- **THEN** the replacing usage records `complete: false`

#### Scenario: A request omitted its counts

- **WHEN** one request of a loop completed without an output token count and the others reported counts
- **THEN** the persisted usage sums the reported counts
- **AND** records `complete: false`

#### Scenario: Nothing was reported

- **WHEN** no model request of an attempt on a priced model reported input or output counts
- **THEN** the persisted usage has no token fields and no `costUsd`
- **AND** records `complete: false`

#### Scenario: Nothing was reported on an unpriced model

- **WHEN** no model request of an attempt on a model without configured pricing reported input or output counts
- **THEN** the persisted usage has no token fields and records `costUsd: null`
- **AND** records `complete: false`

#### Scenario: A reclaimed Run is incomplete

- **WHEN** an attempt settles a Run, and a different attempt for the same message had reached prompt preparation
- **THEN** the persisted usage records `complete: false`

#### Scenario: A reclaim before any preparation stays complete

- **WHEN** an earlier attempt was reclaimed before prompt preparation
- **AND** all requests of the attempt that settles the Run reported counts
- **THEN** the persisted usage records `complete: true`

#### Scenario: Another Run's attempts do not affect completeness

- **WHEN** a different Run, of the same or another owner, has prompt receipts from several attempts
- **THEN** those receipts do not mark the usage of the settled Run incomplete

#### Scenario: A dispatched reply records running usage

- **WHEN** the dispatch transaction of an attempt creates the assistant reply of the Run, or the dispatch of a retry resets it
- **THEN** the reply usage is `{ status: 'running', complete: false, runId, attemptId, modelId, effort, permissionMode }` for that attempt
- **AND** it holds `permissionMode: 'bypass'` only when the effective mode of that attempt is `bypass`, and no token, cost, or `billing` field
- **AND** search and conversation reads treat it as non-completed
- **AND** the attempt that settles the Run does not count it as an earlier reply
- **AND** every finalizer of the Run replaces it with a terminal status

#### Scenario: A reply that a steer closed is complete

- **WHEN** every request of the first segment reported counts, and a steer delivery closes its reply while the Run is not terminal
- **THEN** the usage of that reply records `complete: true`
- **AND** the attempt of the second segment does not mark it incomplete
