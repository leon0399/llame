## MODIFIED Requirements

### Requirement: A request with a started tool call is not sent again

A send whose tool call started MUST NOT get a request retry, for any failure class. That send MUST
NOT get a quota wait of its own. A tool call MUST count as started when the send has streamed its
complete tool-call part. When the send is a step of a Run, the Run MUST wait for its started calls.
It MUST then continue, wait for a quota reset, or fail, as the requirements below state. For
another caller, the request MUST fail with that failure class, and the failure rule of its caller
applies.

#### Scenario: The stream breaks after a tool call

- **WHEN** a Run step streams a complete `read` tool-call part and then breaks
- **THEN** the request is not sent again, and the `read` call executes once
- **AND** the Run continues with the next step, and that step carries the `read` result

#### Scenario: An overload after a tool call

- **WHEN** a Run step streams a complete `read` tool-call part and then an `overloaded_error` event
- **THEN** the Run continues after the `read` call settles, and the `read` call does not execute twice

#### Scenario: A usage limit after a tool call

- **WHEN** a Codex Run step streams a complete `bash` tool-call part and then `usage_limit_reached` with a reset in two days
- **THEN** the Run enters `awaiting_quota` after the `bash` call settles
- **AND** the woken Run sends the next step with the `bash` result, and the `bash` call does not execute again

#### Scenario: A hosted search breaks after its search tool call

- **WHEN** a hosted web search send streams its provider search tool-call part and then breaks
- **THEN** the engine fails with `upstream_error`, and the Run continues

#### Scenario: An authentication failure after a tool call

- **WHEN** a Run step streams a complete `read` tool-call part and then fails with `auth`
- **THEN** the Run fails with `error.code` `auth` after the `read` call settles
- **AND** the reply holds the result of the `read` tool, not a termination result

## ADDED Requirements

### Requirement: A failed send waits for its started tool calls

When a send of a Run step fails after a started tool call, the Run MUST wait until each started call
of that send settles. A call settles with success, an error, or `outcome_unknown`. The Run MUST NOT
cancel a started call because the send failed. The Run MUST NOT send a step request during the wait. It MUST decide by the failure class only after the wait. This rule MUST apply to each failure
class.

#### Scenario: One call still runs when the send breaks

- **WHEN** a send streams complete `read` and `bash` tool-call parts, and it breaks while the `bash` call runs
- **THEN** the Run sends no request until the `bash` call returns its result
- **AND** the next step carries the `read` result and the `bash` result

#### Scenario: The owner stops the Run during the wait

- **WHEN** the owner stops the Run while it waits for a started `bash` call of a failed send
- **THEN** the Run is cancelled, and termination settles the `bash` call
- **AND** the reply does not hold the text after the last tool part, and it holds the `provider-failure` notice

#### Scenario: A rejected call does not cause a second send

- **WHEN** a send streams a complete tool-call part, the permission policy rejects that call, and then the send breaks
- **THEN** the request is not sent again, and the Run continues with the next step
- **AND** that step carries the rejection result of the call

### Requirement: The Run keeps the parts of the failed send through its last settled tool part

The Run MUST keep the parts of the failed send through its last settled tool part, as `turn-actions`
defines that part. It MUST also keep the context items directly after it. The later parts of that
send are the cut. A `model.superseded` event MUST name the cut, in each outcome of the wait. That
event names no kept part. The next request MUST carry the kept parts, and no part of the cut.

#### Scenario: The text after the last tool call is not kept

- **WHEN** a send streams text, a complete `read` tool-call part, more text, and then breaks
- **THEN** the reply keeps the first text and the `read` part with its result
- **AND** the live view removes the text after the `read` part, and a reload shows the same parts
- **AND** the next request does not carry the text after the `read` part

#### Scenario: Text between two kept calls stays

- **WHEN** a send streams a `read` tool-call part, text, a `grep` tool-call part, more text, and then breaks
- **THEN** the reply keeps the `read` part, the text after it, and the `grep` part
- **AND** only the text after the `grep` part is superseded

### Requirement: The cut and the notice are stored together

The Run MUST append the `model.superseded` event of the cut and store the `provider-failure` notice
in one fenced write. When the Run continues, that write MUST come before the retry delay of the
next step. A worker that stops before that write MUST leave neither of them.

#### Scenario: A worker stops before the next step starts

- **WHEN** a send breaks after a settled `read` call, and the worker stops after the call settles and before the next step starts
- **THEN** the reply holds neither the cut nor the notice

#### Scenario: A worker stops during the delay of the next step

- **WHEN** a send breaks after a settled `edit` call, and the worker stops during the delay before the first send of the next step
- **THEN** the redelivered attempt fails the Run with `error.code` `outcome_unknown`
- **AND** the reply holds the cut and the notice

### Requirement: The next step uses the budgets of the failed request

The next step MUST continue the request-retry count and the wait count of the failed request.
Its first send is a new request, not a request retry. When the failure class gets a request retry,
that send MUST still count as one. It MUST wait the delay of that retry number and append one
`model.retrying` event with it. The web MUST show the line of that retry.

#### Scenario: A provider breaks after each tool call

- **WHEN** a provider breaks after a complete `read` tool-call part on each of 11 sends in a row
- **THEN** the Run fails with `error.code` `stream_broken` after 11 sends
- **AND** each `read` call executes once

#### Scenario: A reload during the delay of the next step

- **WHEN** the owner reloads the Chat during the delay before the first send of the next step, after a third broken send
- **THEN** the event stream replays the `model.retrying` event with retry number 3

#### Scenario: No retry is left for the next step

- **WHEN** a send breaks after a tool call, and its request already used 10 request retries
- **THEN** the Run fails with `error.code` `stream_broken` after the call settles

#### Scenario: A second usage limit after a woken tool call

- **WHEN** a woken next step streams a complete `bash` tool-call part, and then fails with `usage_limit_reached` and a reset in range
- **THEN** the Run enters `awaiting_quota` with a wait count of 2

### Requirement: Some events end the counts of the next step

A later step send of the Run that ends without failure MUST end both counts. A quota wait MUST end
the request-retry count, as for every woken request. The Run MUST decide by the failure class
before it delivers at the step boundary before the next step. A delivery there starts a segment.
That segment MUST start with no carried request-retry count and no retry delay.

#### Scenario: A send without failure ends the count

- **WHEN** a send breaks after a tool call, the next step ends without failure, and a later send breaks after a tool call
- **THEN** the transcript shows "Retrying after a broken stream (1/10)" before the step after that later send

#### Scenario: A steer at the boundary starts a new count

- **WHEN** a send breaks with `stream_broken` after a tool call on its fifth send, and the owner sent a steer before the calls settled
- **THEN** the steer starts a segment, and its first send goes out with no retry delay and no `model.retrying` event

#### Scenario: A failure with no retry does not deliver a pending steer

- **WHEN** a send fails with `auth` after a tool call, and the owner sent a steer before the calls settled
- **THEN** the Run fails with `error.code` `auth`, and no segment of that Run delivers the steer

### Requirement: A wait call of a failed send does not open

A `wait` call of a send that failed after a started tool call MUST NOT open. It MUST settle with a
result that states that the wait did not start. The Run MUST NOT enter `awaiting_jobs` for it.

#### Scenario: A wait call in a broken send

- **WHEN** a send streams a complete `bash` tool-call part and a `wait` tool-call part, and then breaks
- **THEN** the Run does not enter `awaiting_jobs`, and the `wait` part holds a result that states that the wait did not start
- **AND** the Run continues with the next step

### Requirement: A provider-failure notice follows the last settled tool part

After the wait, the reply MUST hold one context item with producer `provider-failure` and form
`notice`. It MUST be directly after the last settled tool part of the failed send. This MUST be true
when the Run continues, waits for a quota reset, fails, or expires. It MUST also be true when an
interrupt or a cancellation ends the wait. Each later request that carries that tool part MUST also
carry the notice.

#### Scenario: The next request carries the notice

- **WHEN** the Run continues after a send that broke after a `read` call
- **THEN** the next request carries the `read` result, and then the notice as a user-role message

#### Scenario: Owner Continue keeps the notice

- **WHEN** a Run fails with `auth` after a `read` call, and the owner continues the reply
- **THEN** the first request of the Continue Run carries the `read` result, and then the notice

#### Scenario: An interrupt during the wait keeps the notice

- **WHEN** the owner interrupts the Run while it waits for a started `bash` call of a failed send
- **THEN** the reply of the closed segment holds the `bash` part and then the notice

### Requirement: The provider-failure notice has a fixed text

The body of the notice MUST start with "Your previous response stopped because the provider
failed:" and the label of the failure class. The label MUST be a fixed plain-language name, not the
class code. The body MUST then state: "Each tool call above has its result. Your output after the
last result is not kept." It MUST NOT carry a provider message, header, or body.

#### Scenario: A broken stream has a label

- **WHEN** a send breaks with `stream_broken` after a `read` call
- **THEN** the notice body names "a broken stream", and it does not contain `stream_broken`
