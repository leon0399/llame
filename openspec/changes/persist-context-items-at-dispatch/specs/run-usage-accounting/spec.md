## MODIFIED Requirements

### Requirement: Usage records whether it is complete

Every newly persisted assistant message usage SHALL carry a boolean `complete`. The reply a Run creates in its first dispatch transaction SHALL carry the `running` usage `{ status: 'running', complete: false, runId, attemptId, modelId, effort, permissionMode }`, with `effort` omitted when the Run has none and `permissionMode: 'bypass'` present only when the dispatching attempt's effective mode is `bypass`; a later attempt's dispatch transaction resets it with that attempt's `attemptId` and effective mode. `running` SHALL exist only on such a reply, SHALL count as non-completed everywhere, and SHALL carry no token, cost, latency, measured-size, or `billing` field: the field rules of this capability apply to the terminal usage that replaces it. Every finalizer of the reply SHALL replace the `running` usage with a terminal status (`completed`, `error`, or `aborted`) and the `complete` value decided below. A terminal usage SHALL be `false` when any of the following holds, and `true` otherwise:

- a model request of the attempt completed without reporting an input or an output token count;
- the attempt ended failed, cancelled, or expired, whether or not a model request was in flight, or the Run's recorded terminal status is not `completed` when the usage is written;
- another attempt of the same Run reached prompt preparation;
- the usage replaces the usage of an earlier assistant reply to the same user message, whose recorded spend is not carried forward. The Run's own `running` usage is not an earlier reply for this rule.

A model request reports its usage when the provider delivers that request's usage, whether or not the tools it requested have finished. An incomplete aggregate SHALL keep the known tokens and cost of the requests that did report, as a lower bound. When no request of the attempt reported any input or output count, the token fields SHALL be absent rather than zero. `costUsd` follows pricing first: a model without configured pricing SHALL record `costUsd: null` in every case, and a priced model SHALL omit `costUsd` only when no request reported any input or output count. Missing cache detail counts SHALL be treated as zero under the existing provider rules and SHALL NOT by themselves mark usage incomplete.

#### Scenario: Every request reported

- **WHEN** every model request of a completed attempt reported input and output counts and no other attempt of the Run reached prompt preparation
- **THEN** the persisted usage records `complete: true`

#### Scenario: A late completion under an expired Run is incomplete

- **WHEN** an attempt's final request completes after the Run was already recorded as expired, and its usage is still persisted
- **THEN** the persisted usage records `complete: false`

#### Scenario: A replacement reply is incomplete

- **WHEN** a later assistant turn replaces an earlier, non-completed assistant reply to the same user message that had recorded usage
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

- **WHEN** an attempt settles a Run for which a different attempt had reached prompt preparation
- **THEN** the persisted usage records `complete: false`

#### Scenario: A reclaim before any preparation stays complete

- **WHEN** an earlier attempt was reclaimed before reaching prompt preparation and the settling attempt's requests all reported counts
- **THEN** the persisted usage records `complete: true`

#### Scenario: Another Run's attempts do not affect completeness

- **WHEN** a different Run, of the same or another owner, has prompt receipts from several attempts
- **THEN** those receipts do not mark the settling Run's usage incomplete

#### Scenario: A dispatched reply records running usage

- **WHEN** an attempt's dispatch transaction creates the Run's assistant reply, or a retry's dispatch transaction resets it
- **THEN** the reply usage is `{ status: 'running', complete: false, runId, attemptId, modelId, effort, permissionMode }` naming that attempt, with `permissionMode: 'bypass'` only when that attempt's effective mode is `bypass`, and with no token, cost, or `billing` field
- **AND** search and conversation reads treat it as non-completed, and the attempt that settles the Run does not count it as an earlier reply it replaces
- **AND** every finalizer of the Run replaces it with a terminal status

### Requirement: Every terminal assistant turn keeps its known usage

When a Run ends failed, cancelled, or expired after its executing attempt started at least one model request, including a cancellation that settles while a tool call is still open, the persisted assistant message usage SHALL contain the aggregate of that attempt's requests that reported before the Run ended, with `complete: false`, and SHALL carry the executing `modelId`, the recorded effort when present, the attempt's latency, and a non-completed turn status (`error` for a failed Run, `aborted` for a cancelled or expired one). The one exception is an attempt that completed after another writer had already expired the Run: its salvaged usage keeps the attempt's own `completed` status, as today, and records `complete: false`. It SHALL NOT record zero tokens or zero cost for requests that did not report. A Run that ends before any of its attempts dispatched a model request has no reply of its own and records no usage, as today. A finalizer whose own attempt is not the attempt named in the reply's `running` usage, whether a settlement performed outside an executing attempt (dead-letter expiry, settlement after recovery from an unsettled native effect, cancellation before an attempt starts, admission expiry, or failure at pickup) or a later attempt that fails, is cancelled, or expires before its own dispatch, SHALL replace that `running` usage with the turn status (`error` for a failed Run, `aborted` for a cancelled or expired one), `complete: false`, the `runId`, `attemptId`, `modelId`, effort, and `permissionMode` recorded on the `running` usage when present, and `billing`, and SHALL record no token counts, no latency, and no measured context size, with `costUsd` as for usage on which no request reported. A cancelled turn settled with an open tool call SHALL therefore carry the same non-completed status as any other cancelled turn, and SHALL be retryable and excluded from conversation evidence exactly as those turns are.

#### Scenario: A failure after a completed tool request

- **WHEN** an attempt completes a reported tool-requesting request and then fails during the next request
- **THEN** the assistant message usage records the first request's tokens and cost
- **AND** records `complete: false` and status `error`

#### Scenario: Cancellation with an open tool call

- **WHEN** an owner cancels a Run while a tool call requested by a model request whose usage the provider already delivered is still open
- **THEN** the cancelled assistant message usage records that request's tokens, cost, `modelId`, and latency
- **AND** records `complete: false`

#### Scenario: Failure before any report

- **WHEN** an attempt on a priced model fails during its first model request
- **THEN** the assistant message usage has no token fields and no `costUsd`
- **AND** still records `modelId`, latency, status, and `complete: false`

#### Scenario: A cancelled open-tool turn is treated like other cancelled turns

- **WHEN** a Run is cancelled while a tool call is open and its assistant turn is persisted
- **THEN** that turn's usage records status `aborted`
- **AND** conversation search and reads exclude it as they exclude any other non-completed assistant turn

#### Scenario: An out-of-attempt settlement records terminal identity without tokens

- **WHEN** an attempt dispatched a model request and its process died, and the Run is then finalized by a writer whose own attempt is not that attempt: dead-letter expiry, native-recovery settlement, cancellation before the next attempt starts, admission expiry, failure at pickup, or a later attempt that fails, is cancelled, or expires before its own dispatch
- **THEN** the reply usage records status `error` or `aborted` as the Run's terminal status requires, `complete: false`, and the `runId`, `attemptId`, `modelId`, effort, and `permissionMode` of the `running` usage it replaces, each when present
- **AND** it records no token counts, no latency, and no measured context size
- **AND** no reply of that Run keeps status `running`
