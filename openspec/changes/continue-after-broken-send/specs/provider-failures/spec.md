## MODIFIED Requirements

### Requirement: A request with a started tool call is not sent again

A send whose tool call started MUST NOT get a request retry, for any failure class. That send MUST
NOT get a quota wait of its own. A tool call MUST count as started when the send has streamed its
complete tool-call part. When the send is a step of a Run, the Run MUST then wait, keep, and
continue or fail, as the requirements below state. For another caller, the request MUST fail with
that failure class, and the failure rule of its caller applies.

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
cancel a started call because the send failed. The Run MUST decide by the failure class only after
that wait. This rule MUST apply to each failure class.

#### Scenario: One call still runs when the send breaks

- **WHEN** a send streams complete `read` and `bash` tool-call parts, and it breaks while the `bash` call runs
- **THEN** the Run waits until the `bash` call returns its result
- **AND** the next step carries the `read` result and the `bash` result

#### Scenario: The owner stops the Run during the wait

- **WHEN** the owner stops the Run while it waits for a started `bash` call of a failed send
- **THEN** the Run is cancelled, and termination settles the `bash` call
- **AND** the reply holds the `provider-failure` notice after the last settled tool part

#### Scenario: A rejected call does not cause a second send

- **WHEN** a send streams a complete tool-call part, the permission policy rejects that call, and then the send breaks
- **THEN** the request is not sent again, and the Run continues with the next step
- **AND** that step carries the rejection result of the call

### Requirement: The next step keeps the settled parts of the failed send

A settled tool part is a tool part with a result. The Run MUST keep the parts of the failed send
through its last settled tool part, and the context items directly after it. Before the Run
continues, waits, or fails, a `model.superseded` event MUST name the parts of that send after them.
The next request MUST carry the kept parts. It MUST NOT carry a superseded part.

#### Scenario: The text after the last tool call is not kept

- **WHEN** a send streams text, a complete `read` tool-call part, more text, and then breaks
- **THEN** the reply keeps the first text and the `read` part with its result
- **AND** the live view removes the text after the `read` part, and a reload shows the same parts
- **AND** the next request does not carry the text after the `read` part

### Requirement: The next step uses the budgets of the failed request

The next step MUST continue the request-retry count and the quota-wait count of the failed request.
When the failure class gets a request retry, the first send of the next step MUST use the next
retry of that count. It MUST wait the delay of that retry and append its `model.retrying` event.
The web MUST show the line of that retry. A send that ends without failure MUST end both counts.

#### Scenario: A provider breaks after each tool call

- **WHEN** a provider breaks after a complete `read` tool-call part on each of 11 sends in a row
- **THEN** the Run fails with `error.code` `stream_broken` after 11 sends
- **AND** each `read` call executes once

#### Scenario: A send without failure ends the count

- **WHEN** a send breaks after a tool call, the next step ends without failure, and a later send breaks after a tool call
- **THEN** the transcript shows "Retrying after a broken stream (1/10)" before the step after that later send

#### Scenario: A reload during the delay of the next step

- **WHEN** the owner reloads the Chat during the delay before the first send of the next step, after a third broken send
- **THEN** the event stream replays the `model.retrying` event with retry number 3

#### Scenario: No retry is left for the next step

- **WHEN** a send breaks after a tool call, and its request already used 10 request retries
- **THEN** the Run fails with `error.code` `stream_broken` after the call settles

### Requirement: A provider-failure notice follows the last settled tool part

After the wait, the reply MUST hold one context item with producer `provider-failure` and form
`notice`. It MUST be directly after the last settled tool part of the failed send. This MUST be
true when the Run continues, waits for a quota reset, fails, or is cancelled during the wait. Each
later request that carries that tool part MUST also carry the notice.

#### Scenario: The next request carries the notice

- **WHEN** the Run continues after a send that broke after a `read` call
- **THEN** the next request carries the `read` result, and then the notice as a user-role message

#### Scenario: Owner Continue keeps the notice

- **WHEN** a Run fails with `auth` after a `read` call, and the owner continues the reply
- **THEN** the first request of the Continue Run carries the `read` result, and then the notice

### Requirement: The provider-failure notice has a fixed text

The body of the notice MUST start with "Your previous response stopped because the provider
failed:" and the label of the failure class. The label MUST be a fixed plain-language name, not the
class code. The body MUST then state: "Each tool call above has its result. Your output after the
last result is not kept." It MUST NOT carry a provider message, header, or body.

#### Scenario: A broken stream has a label

- **WHEN** a send breaks with `stream_broken` after a `read` call
- **THEN** the notice body names "a broken stream", and it does not contain `stream_broken`
