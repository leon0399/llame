## MODIFIED Requirements

### Requirement: No mid-run tool-state checkpointing (read-only slice; write-tool landmine)

The read-only loop can retry a claimable Run from the first step of its current segment, with new
worker context. It can do this only when that segment has no recorded native attempt or MCP
dispatch. A retry MUST keep the delivered messages and the replies of earlier segments. A retry
MUST resolve its own prompt and its own attempt-local catalog again. It MUST NOT use the
preparation of the failed attempt. It MUST compare availability with the id and state record that
its Run stored when an earlier attempt dispatched. When no such record exists, it MUST compare
with the record of the most recent earlier dispatched Run. The persisted output of the failed
attempt stays part of the committed record that later turns load. A follow-up Run from
`turn-actions` can replace that reply.

A Run that executed an alpha native `edit` or `write` MUST NOT replay that mutation
automatically. This applies after a worker failure, a timeout, or an unknown settlement. A Run
that dispatched an MCP operation MUST NOT replay that operation automatically. The host MUST stop
the affected Run with `outcome_unknown` and require a new explicit user or model attempt. A
client reconnect MUST replay recorded tool activity. It MUST NOT execute the mutation or the MCP
operation again.

A redelivered Run with a recorded `native.attempt` in its current segment MUST fail as
`outcome_unknown`. It MUST NOT replay its loop. A recorded `native.attempt` of an earlier segment
has a settled result, and it MUST NOT stop the retry. This recovery rule has no native-executor
or `workerId` precondition. Before terminal settlement, the host MUST settle each open call that
has a durable `native.result` from that result, whatever the tool source. Recovery MUST first
arbitrate with any pending host promotion under their shared durable fence. It uses a committed
promotion's result, or records `outcome_unknown` if recovery wins before promotion. An open
`bash`, native mutation, or MCP call with a recorded `native.attempt` and no competing promotion
or result MUST settle as `outcome_unknown`. Every other open call settles as the termination
settlement rules require.

Only a Continue that the owner requests through `turn-actions` can carry the settled tool-loop
state of a terminal Run into a new Run. That Continue Run MUST replay the settled results. It
MUST NOT execute a settled call again. A future durable effect-dedupe capability can replace
this terminal behavior, and this capability does not define it.

A wake of a Run from `awaiting_jobs` is not a retry. The first attempt after a wake MUST
continue from the stored steps of the current reply, as the requirement for a woken Run defines.
A redelivered queue job of a woken Run is a retry, and it MUST follow the rules of this
requirement.

#### Scenario: Known native mutation result is replayed without execution

- **WHEN** a native edit or write settled before a client reconnect
- **THEN** replay returns the recorded tool result
- **AND** the filesystem mutation does not execute again

#### Scenario: Worker death mid-loop does not resume tool state

- **WHEN** the worker dies after several completed tool steps, and the deadman expires the Run
- **THEN** the Run ends under the rules that apply today
- **AND** no new Run resumes the partial tool-loop state, unless the owner requests a Continue

#### Scenario: Refresh does not re-execute tools

- **WHEN** a client reconnects to a live Run after tool steps completed
- **THEN** replay builds those steps again from durable events and does not execute a native mutation again

#### Scenario: Worker failure does not replay a native mutation

- **WHEN** a worker fails after a native mutation or an MCP dispatch can have started, and before its result is known
- **THEN** the host settles the effect as `outcome_unknown`, and the Run stops
- **AND** a queue retry does not invoke that mutation or MCP operation again

#### Scenario: A queue retry re-executes the loop from the start

- **WHEN** the queue retries the job of a read-only Run, the Run is still claimable, and no `native.attempt` is recorded
- **THEN** its tool loop executes again from the first step of its current segment
- **AND** it can invoke again the read-only tools that the earlier attempt invoked

#### Scenario: A terminal run is never reopened by a retry

- **WHEN** the queue retries a job for a Run that is already terminal
- **THEN** the Run does not open again, no tool executes, and its terminal state stays

#### Scenario: Read-only retry remains unchanged

- **WHEN** a claimable Run holds only read-only tools, has no recorded `native.attempt`, and its job retries
- **THEN** the read-only retry behavior of today stays available
- **AND** the host infers no native mutation from the read-only result

#### Scenario: A Continue carries settled tool results into a new Run

- **WHEN** a Run failed after a settled `edit` call and a settled `bash` call with `outcome_unknown`, and the owner continues it
- **THEN** the Continue Run gives the model both stored results
- **AND** it does not execute either call again

#### Scenario: A settled write in an earlier segment does not stop a retry

- **WHEN** the first segment of a Run settled a native `write`
- **AND** the worker dies in the second segment before a native attempt of that segment
- **THEN** the retry restarts the second segment from its delivered message
- **AND** the `write` does not execute again

#### Scenario: A wake does not restart the segment

- **WHEN** a Run leaves `awaiting_jobs` after two completed tool steps of its current segment
- **THEN** the first attempt after the wake keeps both steps and executes neither call again

#### Scenario: A retry after a wake restarts a read-only segment

- **WHEN** the queue retries the job of a woken Run whose current segment has no `native.attempt`
- **THEN** the tool loop executes again from the first step of that segment

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

For any host `bash` promotion, including one triggered by a steer, interrupt, or job notice, the per-call timeout SHALL NOT settle the call while the promotion outcome is unresolved. The host MUST wait for the authoritative durable outcome; a committed promotion produces `backgrounded`, and a promotion that loses to recovery produces the recovery result. This exception applies only to the host promotion; all other tool timeout behavior remains unchanged.

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

#### Scenario: A committed promotion wins over timeout settlement

- **WHEN** a host `bash` promotion commits while the call's per-call timeout is due
- **THEN** the call records the committed `backgrounded` result
- **AND** the Run does not advance before the promotion outcome is authoritative

#### Scenario: Recovery wins before host promotion

- **WHEN** recovery settles an open host `bash` attempt before promotion commits
- **THEN** the attempt records `outcome_unknown` and the Run fails
- **AND** the promotion creates no job

#### Scenario: A lost promotion acknowledgement is resolved durably

- **WHEN** the promotion transaction commits but its acknowledgement is lost
- **THEN** the host resolves the result under the durable fence
- **AND** it does not treat the commit as a rollback or settle the call twice

### Requirement: Cooperative cancellation reaches tool execution

Tool execution SHALL receive a cancellation signal derived from both the run's termination and the effective per-call timeout, so a tool that supports cooperative cancellation can abandon work whose result can no longer be used. The same per-call timeout signal SHALL drive both the execution context and the timeout race. A tool that ignores the signal SHALL still be bounded by that timeout and SHALL still produce a structured result. The signal SHALL come from the trusted execution context, never from model-controlled arguments.

A cooperative rejection caused by the per-call timeout SHALL produce the structured `timeout` outcome. A rejection caused by the parent run abort SHALL NOT be recorded as `execution_failed` or win first settlement; the call SHALL remain open for the run's terminal settlement so its durable outcome agrees with the terminal run state.

For a host `bash` call with promotion pending, parent cancellation SHALL NOT settle the call before promotion and recovery arbitrate its durable result. Cancellation before promotion starts retains the existing terminal settlement behavior; while promotion is pending, the call and Run remain unresolved until the authoritative outcome is known. This exception does not change cancellation or timeout behavior for remote bash.

#### Scenario: Run cancellation reaches an executing tool

- **WHEN** a run is cancelled while a tool is executing
- **THEN** that tool's execution context observes cancellation

#### Scenario: Per-call timeout still bounds an uncooperative tool

- **WHEN** an executing tool ignores the cancellation signal
- **THEN** it is still bounded by its effective timeout and still yields a structured result

#### Scenario: A cooperative per-call timeout remains a timeout

- **WHEN** a tool rejects after observing its per-call timeout signal
- **THEN** its structured outcome is `timeout`, not `execution_failed`

#### Scenario: A parent abort remains terminal settlement

- **WHEN** a tool rejects after observing the parent run abort
- **THEN** that rejection does not settle the call as `execution_failed`, and the run's terminal settlement supplies the first and only durable outcome

#### Scenario: Abort before host promotion uses terminal settlement

- **WHEN** the Run aborts before a host `bash` promotion starts
- **THEN** the call remains open for the Run's terminal settlement
- **AND** the command is not represented as a committed background job

#### Scenario: Abort during host promotion waits for arbitration

- **WHEN** the Run aborts while host `bash` promotion is pending
- **THEN** the call remains unsettled until promotion or recovery wins the durable fence
- **AND** the Run does not advance before the authoritative result is known

## ADDED Requirements

### Requirement: A tool can yield to a steer

A tool can declare that it yields. `wait` and `bash` on the llame host MUST yield, and no other
tool does. A steer, an interrupt, or a job notice can signal the Run. A host `bash` call that
yields MUST begin promotion without waiting for command completion. Its final result waits for
the authoritative durable outcome; no model step or delivery advances while that outcome is
unresolved. A successful promotion continues as a job of `background-jobs`. A `wait` call that
yields follows its own settlement rules.

#### Scenario: A read does not yield

- **WHEN** the owner sends a steer while a `read` of a web locator runs
- **THEN** the `read` finishes with its own result before the steer is delivered

#### Scenario: Two commands yield at one signal

- **WHEN** two host `bash` calls of one step run in the foreground, and the owner sends a steer
- **THEN** both calls return `backgrounded`, and both commands continue

### Requirement: Only a wait call stays open while its Run waits

A `wait` call MUST be the only tool call that stays open while a Run is in `awaiting_jobs`. The
Run MUST settle every other call of the step before it enters that status. A step MUST hold at
most one open `wait` call, and a second `wait` call in the step MUST return an error. A `wait`
call MUST NOT record a native attempt, because it has no effect on the host.

#### Scenario: A wait beside a read in one step

- **WHEN** the model calls `read` and `wait` in one step
- **THEN** the `read` result is stored before the Run enters `awaiting_jobs`

#### Scenario: Two wait calls in one step

- **WHEN** the model calls `wait` twice in one step
- **THEN** the second call returns an error that names the first call, and the Run waits on the first call only

### Requirement: A woken Run settles the wait and continues from its stored steps

When a Run leaves `awaiting_jobs`, its attempt MUST record the result of the open `wait` call
exactly once. It MUST then send the next model request with the history and the stored steps of
the current reply, through that result. It MUST NOT execute a settled call again. A redelivered
queue job of the woken Run MUST follow the retry rules of `No mid-run tool-state checkpointing`.

#### Scenario: A build fails while the Run waits

- **WHEN** a Run waits on a build, the build fails, and another worker claims the Run
- **THEN** the reply keeps its earlier steps, and the `wait` call gets the result that names the failed build
- **AND** the next model request carries those steps and that result

#### Scenario: A worker stops after the wake

- **WHEN** the current segment holds no native attempt, and the worker stops after it recorded the `wait` result
- **THEN** the retry executes the segment again from its first step
- **AND** a new `wait` call on the settled job returns at once

#### Scenario: A worker stops after the wake of a segment with a command

- **WHEN** the current segment holds a `bash` attempt, and the worker stops after the wake
- **THEN** the redelivered Run fails as `outcome_unknown`, and the owner can start a Continue

### Requirement: The stop tool is a host-capability tool

`stop` MUST have the `execute_code` classification, and it MUST be in the exact host-capability
set. It MUST be available only on a process that can run host `bash`. Its retry policy is this:
a retried `stop` call requests the stop again, and a job that is already settled keeps its
state. `wait` MUST have the `read_only` classification.

#### Scenario: Stop is advertised with bash

- **WHEN** `tools.allowed` names `bash` and `stop`, and the process accepted native host authority
- **THEN** the system advertises `stop`

#### Scenario: Stop without host authority is not advertised

- **WHEN** `tools.allowed` names `stop`, and the process accepted no native host authority
- **THEN** the system does not advertise `stop` and does not execute it
